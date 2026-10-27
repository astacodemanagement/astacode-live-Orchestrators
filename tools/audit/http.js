'use strict';
// Lapisan HTTP untuk crawler: permintaan dengan batas waktu, rantai redirect manual, pembatas kecepatan per host, parser robots.txt.
const UA = 'AstacodeAuditBot/1.0 (+https://astacode.id)', UA_TOKEN = 'astacodeauditbot';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REDIRECT = new Set([301, 302, 303, 307, 308]);

async function request(url, { method = 'GET', timeout = 15000, maxBytes = 3_000_000, headers = {}, wantBody = true, forceText = false } = {}) {
  const t0 = performance.now(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { method, redirect: 'manual', signal: ctl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'id,en;q=0.8', 'accept-encoding': 'gzip, deflate, br', ...headers } });
    const ttfb = Math.round(performance.now() - t0), h = {}; res.headers.forEach((v, k) => { h[k] = v; });
    if (typeof res.headers.getSetCookie === 'function') { const sc = res.headers.getSetCookie(); if (sc.length) h['set-cookie'] = sc.join('; '); }
    const ct = (h['content-type'] || '').toLowerCase(); let body = null, bytes = 0;
    const textual = forceText || /text\/|xml|json|xhtml/.test(ct);   // forceText: robots.txt/sitemap sering tanpa Content-Type yang benar
    if (method === 'GET' && wantBody && res.status >= 200 && res.status < 300 && textual) {
      const buf = Buffer.from(await res.arrayBuffer()); bytes = buf.length;
      body = new TextDecoder('utf-8').decode(buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf);
    } else { try { await res.body?.cancel(); } catch (_) { /* abaikan */ } }
    return { url, status: res.status, headers: h, ttfb, ms: Math.round(performance.now() - t0), body, bytes, location: h.location || null, contentType: ct, error: null };
  } catch (e) {
    return { url, status: 0, headers: {}, ttfb: null, ms: Math.round(performance.now() - t0), body: null, bytes: 0, location: null, contentType: '', error: e.name === 'AbortError' ? 'timeout' : String((e.cause && e.cause.code) || e.message || e) };
  } finally { clearTimeout(to); }
}

// Ikuti redirect satu per satu agar rantai, loop, dan jenis redirect (301/302) tercatat.
async function fetchChain(url, opts = {}, limiter) {
  const chain = [], seen = new Set(); let cur = url, last = null;
  for (let hop = 0; hop < 10; hop++) {
    if (limiter) await limiter.wait(cur);
    last = await request(cur, opts);
    if (!REDIRECT.has(last.status) || !last.location) break;
    let next; try { next = new URL(last.location, cur).href; } catch (_) { break; }
    chain.push({ url: cur, status: last.status, to: next });
    if (seen.has(next) || next === cur) return { chain, final: last, finalUrl: cur, loop: true };
    seen.add(cur); cur = next;
  }
  return { chain, final: last, finalUrl: cur, loop: false };
}

// Pembatas kecepatan: jeda minimum antar permintaan ke host yang sama.
class Limiter {
  constructor(minMs) { this.minMs = minMs; this.next = new Map(); }
  async wait(url) {
    let host; try { host = new URL(url).host; } catch (_) { return; }
    const now = Date.now(), at = Math.max(now, this.next.get(host) || 0); this.next.set(host, at + this.minMs);
    if (at > now) await sleep(at - now);
  }
}

class Robots {
  constructor(text = '') {
    this.groups = []; this.sitemaps = []; let cur = null, lastWasUa = false;
    for (let line of String(text).split(/\r?\n/)) {
      line = line.replace(/#.*$/, '').trim(); const k = line.indexOf(':'); if (k < 0) continue;
      const key = line.slice(0, k).trim().toLowerCase(), val = line.slice(k + 1).trim();
      if (key === 'user-agent') { if (!lastWasUa) { cur = { agents: [], rules: [], delay: null }; this.groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasUa = true; continue; }
      lastWasUa = false;
      if (key === 'sitemap') this.sitemaps.push(val);
      else if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
      else if (cur && key === 'crawl-delay') cur.delay = parseFloat(val) || null;
    }
  }
  group(ua = UA_TOKEN) {
    return this.groups.find(g => g.agents.some(a => a !== '*' && ua.includes(a))) || this.groups.find(g => g.agents.includes('*')) || null;
  }
  allowed(url, ua = UA_TOKEN) {
    const g = this.group(ua); if (!g) return true;
    let u; try { u = new URL(url); } catch (_) { return true; } const p = u.pathname + u.search;
    let best = null;
    for (const r of g.rules) {
      if (!r.path) continue;
      const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$').replace(/\$$/, '$'));
      if (re.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    }
    return best ? best.allow : true;
  }
  blocksAll(ua = UA_TOKEN) { const g = this.group(ua); return !!g && g.rules.some(r => !r.allow && r.path === '/') && !g.rules.some(r => r.allow && r.path === '/'); }
  delay() { const g = this.group(); return g && g.delay ? g.delay : null; }
}

const isPrivateHost = h => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || h === '[::1]';
const stripWww = h => h.replace(/^www\./i, '').toLowerCase();

// Normalisasi URL untuk deduplikasi: tanpa fragment, host huruf kecil, tanpa port bawaan.
function norm(u, base) {
  try { const x = new URL(u, base); x.hash = ''; if ((x.protocol === 'http:' && x.port === '80') || (x.protocol === 'https:' && x.port === '443')) x.port = ''; return x.href; } catch (_) { return null; }
}

// Parser sitemap (XML sederhana): kembalikan {urls:[{loc,lastmod}], sitemaps:[loc]} untuk urlset atau sitemapindex.
function parseSitemap(xml) {
  const urls = [], sitemaps = [];
  const blocks = (tag) => [...String(xml).matchAll(new RegExp('<' + tag + '[\\s>][\\s\\S]*?</' + tag + '>', 'gi'))].map(m => m[0]);
  const get = (b, t) => { const m = new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>', 'i').exec(b); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null; };
  for (const b of blocks('url')) { const loc = get(b, 'loc'); if (loc) urls.push({ loc, lastmod: get(b, 'lastmod') }); }
  for (const b of blocks('sitemap')) { const loc = get(b, 'loc'); if (loc) sitemaps.push(loc); }
  const valid = /<(urlset|sitemapindex)[\s>]/i.test(xml);
  return { urls, sitemaps, valid };
}
module.exports = { UA, request, fetchChain, Limiter, Robots, isPrivateHost, stripWww, norm, parseSitemap, sleep, REDIRECT };
