'use strict';
// Crawler situs: merayapi halaman internal (patuh robots.txt, dibatasi kecepatannya), lalu memeriksa tautan eksternal & aset.
const { parseHtml } = require('./html');
const H = require('./http');

const ASSET_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|rar|gz|mp4|mp3|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?|apk)(\?|$)/i;
const isHtml = ct => /html/.test(ct || '');

// Ringkasan halaman yang disimpan (bukan seluruh HTML) supaya laporan tetap kecil.
function lean(p) {
  const imgs = p.images || [], http = (p.resources || []).filter(r => /^http:\/\//i.test(r.url) && ['img', 'script', 'css', 'iframe', 'source', 'video', 'audio', 'embed'].includes(r.type)).map(r => r.url);
  return {
    title: p.title, titleCount: p.titleCount, metaDescription: p.metaDescription, metaDescriptionCount: p.metaDescriptionCount, robots: p.robots.trim(),
    canonical: p.canonical, canonicalCount: p.canonicalCount, lang: p.lang, viewport: p.viewport, h1: p.h1, h2: p.h2, wordCount: p.wordCount,
    images: imgs.length, imagesNoAlt: imgs.filter(i => !i.hasAlt).length, ogTitle: !!p.og.title, ogImage: !!p.og.image,
    jsonldTypes: p.jsonldTypes, jsonldBlocks: p.jsonldBlocks, jsonldErrors: p.jsonldErrors, hreflang: p.hreflang.length, mixed: http.slice(0, 5), mixedCount: http.length,
    generator: p.generator, scripts: p.scriptCount,
    h2texts: (p.h2texts || []).slice(0, 12), lists: p.lists, tables: p.tables, times: p.times, authorMeta: p.authorMeta ? String(p.authorMeta).slice(0, 80) : null,
    published: p.published || null, modified: p.modified || null, relAuthor: p.relAuthor, jsonld: p.jsonld,
  };
}

async function fetchSitemaps(origin, robots, robotsOk, limiter, log) {
  const out = { found: false, files: [], urls: [], errors: [] };
  const first = (robots.sitemaps.length ? robots.sitemaps : [origin + '/sitemap.xml']).map(s => H.norm(s, origin)).filter(Boolean);
  const queue = [...new Set(first)], done = new Set();
  while (queue.length && done.size < 25 && out.urls.length < 20000) {
    const u = queue.shift(); if (done.has(u)) continue; done.add(u);
    if (/\.gz(\?|$)/i.test(u)) { out.errors.push({ url: u, error: 'Sitemap terkompresi (.gz) tidak dibaca oleh audit ini' }); continue; }
    const r = await H.fetchChain(u, { forceText: true }, limiter), f = r.final, st = r.chain.length ? r.chain[0].status : f.status;
    const file = { url: u, status: st, urls: 0, valid: false };
    if (f.status === 200 && f.body) {
      const sm = H.parseSitemap(f.body); file.valid = sm.valid; file.urls = sm.urls.length;
      if (!sm.valid) out.errors.push({ url: u, error: 'Isi bukan sitemap XML yang valid' });
      out.urls.push(...sm.urls); sm.sitemaps.forEach(c => { const n = H.norm(c, u); if (n && !done.has(n)) queue.push(n); });
      if (sm.valid) out.found = true;
    } else out.errors.push({ url: u, error: f.error ? 'Gagal dibuka: ' + f.error : 'Status ' + st });
    out.files.push(file);
  }
  return out;
}

// llms.txt: berkas saran untuk mesin AI (belum standar resmi). Dianggap ada bila membalas 200 berisi teks, bukan halaman HTML.
async function fetchLlms(origin) {
  const r = await H.request(origin + '/llms.txt', { timeout: 10000, forceText: true });
  const body = r.status === 200 ? String(r.body || '') : '';
  return { status: r.error ? 0 : r.status, found: r.status === 200 && body.trim().length > 20 && !/^\s*<(!doctype|html)/i.test(body), size: body.length, links: (body.match(/\]\(https?:\/\/[^)]+\)/g) || []).length };
}
async function crawlSite(cfg, hooks = {}) {
  const log = hooks.log || (() => {}), progress = hooks.progress || (() => {});
  const start = new URL(cfg.site), origin = start.origin, ownHost = H.stripWww(start.hostname);
  const maxPages = cfg.maxPages || 300, maxDepth = cfg.maxDepth || 8;
  const limiter = new H.Limiter(Math.max(100, Math.round(1000 / (cfg.rate || 3))));
  const model = { site: start.href, origin, startedAt: new Date().toISOString(), robots: { status: null, blocksAll: false, sitemaps: [], delay: null }, sitemap: null,
    pages: [], externals: [], assets: [], hostChecks: {}, truncated: false, notCrawled: 0 };
  const isInternal = u => { try { return H.stripWww(new URL(u).hostname) === ownHost; } catch (_) { return false; } };

  // robots.txt
  const rr = await H.request(origin + '/robots.txt', { timeout: 10000, forceText: true });
  const robots = new H.Robots(rr.status === 200 ? rr.body || '' : '');
  model.robots = { status: rr.error ? 0 : rr.status, error: rr.error, blocksAll: robots.blocksAll(), sitemaps: robots.sitemaps, delay: robots.delay(), size: (rr.body || '').length, body: rr.status === 200 ? String(rr.body || '').slice(0, 20000) : '' };
  model.llms = await fetchLlms(origin);
  if (robots.delay()) limiter.minMs = Math.max(limiter.minMs, robots.delay() * 1000);
  log('robots.txt: ' + (rr.error || rr.status));

  // sitemap
  model.sitemap = await fetchSitemaps(origin, robots, true, limiter, log);
  log('sitemap: ' + model.sitemap.urls.length + ' URL di ' + model.sitemap.files.length + ' berkas');

  // antrean
  const seen = new Map(), queue = [], assets = new Map(), externals = new Map(), sitemapSet = new Set();
  let fetched = 0, active = 0;
  const mk = (url, depth, inSitemap) => { const rec = { url, depth, inSitemap: !!inSitemap, inlinks: new Set(), outlinks: [], status: null }; seen.set(url, rec); model.pages.push(rec); return rec; };
  const home = H.norm(start.href, origin); queue.push(mk(home, 0, false));
  for (const u of model.sitemap.urls) {
    const n = H.norm(u.loc, origin); if (!n) continue; sitemapSet.add(n);
    if (!isInternal(n)) continue;
    let rec = seen.get(n); if (!rec) { rec = mk(n, null, true); queue.push(rec); } else rec.inSitemap = true; rec.lastmod = u.lastmod || null;
  }
  model.sitemapSet = sitemapSet;

  const addLink = (src, href, base, nofollow) => {
    const raw = String(href || '').trim(); if (!raw || raw[0] === '#') return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return;
    const abs = H.norm(raw, base); if (!abs) return;
    if (isInternal(abs)) {
      if (ASSET_EXT.test(new URL(abs).pathname)) { (assets.get(abs) || assets.set(abs, new Set()).get(abs)).add(src.url); return; }
      let rec = seen.get(abs);
      if (!rec) { if (fetched + queue.length >= maxPages) { model.truncated = true; model.notCrawled++; return; } rec = mk(abs, (src.depth ?? 0) + 1, false); if (rec.depth <= maxDepth) queue.push(rec); }
      rec.inlinks.add(src.url); if (src.outlinks.length < 400) src.outlinks.push(abs);
    } else if (externals.size < 500 || externals.has(abs)) { const e = externals.get(abs) || externals.set(abs, new Set()).get(abs); if (e.size < 5) e.add(src.url); }
  };

  async function processPage(rec) {
    if (!robots.allowed(rec.url)) { rec.blocked = true; return; }
    fetched++; progress({ phase: 'crawl', done: fetched, total: Math.min(maxPages, fetched + queue.length) });
    const r = await H.fetchChain(rec.url, {}, limiter), f = r.final;
    rec.chain = r.chain; rec.loop = r.loop; rec.error = f.error || null;
    rec.status = r.chain.length ? r.chain[0].status : f.status; rec.finalStatus = f.status; rec.finalUrl = H.norm(r.finalUrl, origin);
    rec.ttfb = f.ttfb; rec.bytes = f.bytes; rec.headers = f.headers; rec.contentType = f.contentType; rec.redirectTo = r.chain[0] ? r.chain[0].to : null;
    let target = rec;
    if (r.chain.length && rec.finalUrl && rec.finalUrl !== rec.url && isInternal(rec.finalUrl)) {
      const ex = seen.get(rec.finalUrl);
      if (ex && ex !== rec) { if (ex.status === null) { target = ex; ex.viaRedirect = true; } else target = null; }
      else if (!ex) { target = mk(rec.finalUrl, rec.depth, false); target.viaRedirect = true; }
      if (target && target !== rec) { Object.assign(target, { chain: [], loop: false, error: rec.error, status: f.status, finalStatus: f.status, finalUrl: target.url, ttfb: f.ttfb, bytes: f.bytes, headers: f.headers, contentType: f.contentType }); target.inlinks.add(rec.url); }
    } else if (r.chain.length && !isInternal(rec.finalUrl || '')) { target = null; }
    if (target && f.status === 200 && isHtml(f.contentType) && f.body) {
      const p = parseHtml(f.body); target.parsed = lean(p);
      const base = p.baseHref ? H.norm(p.baseHref, target.url) || target.url : target.url;
      for (const l of p.links) addLink(target, l.href, base, /nofollow/.test(l.rel));
      if (p.canonical) { const c = H.norm(p.canonical, base);   // target canonical ikut dicek statusnya (tanpa dihitung sebagai tautan masuk)
        if (c && isInternal(c) && !ASSET_EXT.test(new URL(c).pathname) && !seen.has(c) && fetched + queue.length < maxPages) { const cr = mk(c, (target.depth ?? 0) + 1, false); cr.canonicalOnly = true; queue.push(cr); } }
      for (const im of p.images) { if (!im.src || /^data:/i.test(im.src)) continue; const abs = H.norm(im.src, base); if (abs && isInternal(abs)) (assets.get(abs) || assets.set(abs, new Set()).get(abs)).add(target.url); }
      for (const rs of p.resources) { if (rs.type === 'css' || rs.type === 'script') { const abs = H.norm(rs.url, base); if (abs && isInternal(abs)) (assets.get(abs) || assets.set(abs, new Set()).get(abs)).add(target.url); } }
    }
  }

  const workers = Array.from({ length: cfg.concurrency || 3 }, async () => {
    for (;;) {
      if (fetched >= maxPages) { if (queue.length) { model.truncated = true; model.notCrawled += queue.length; queue.length = 0; } if (!active) return; await H.sleep(40); continue; }
      const rec = queue.shift();
      if (!rec) { if (!active) return; await H.sleep(40); continue; }
      active++; try { await processPage(rec); } catch (e) { rec.error = 'galat internal: ' + e.message; rec.status = 0; } finally { active--; }
    }
  });
  await Promise.all(workers);
  log('crawl selesai: ' + fetched + ' halaman');

  // tautan eksternal (HEAD, cadangan GET)
  const extList = [...externals.entries()].filter(([u]) => { try { return process.env.AUDIT_ALLOW_PRIVATE === '1' || !H.isPrivateHost(new URL(u).hostname); } catch (_) { return false; } }).slice(0, cfg.maxExternal || 150);
  const extLimiter = new H.Limiter(700); let ei = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { for (;;) { const k = ei++; if (k >= extList.length) return; const [u, srcs] = extList[k];
    progress({ phase: 'eksternal', done: k, total: extList.length });
    await extLimiter.wait(u); let r = await H.request(u, { method: 'HEAD', timeout: 10000 });
    if ([403, 405, 501].includes(r.status) || r.status === 0) { await extLimiter.wait(u); const g = await H.request(u, { method: 'GET', timeout: 12000, wantBody: false }); if (g.status !== 0 || r.status === 0) r = g; }
    model.externals.push({ url: u, status: r.status, error: r.error, sources: [...srcs].slice(0, 5) }); } }));
  // aset internal (gambar, css, js, pdf)
  const asList = [...assets.entries()].slice(0, cfg.maxAssets || 200); let ai = 0;
  await Promise.all(Array.from({ length: 3 }, async () => { for (;;) { const k = ai++; if (k >= asList.length) return; const [u, srcs] = asList[k];
    progress({ phase: 'aset', done: k, total: asList.length });
    await limiter.wait(u); let r = await H.request(u, { method: 'HEAD', timeout: 12000 });
    if ([405, 501].includes(r.status)) r = await H.request(u, { method: 'GET', timeout: 12000, wantBody: false });
    model.assets.push({ url: u, status: r.status, error: r.error, bytes: parseInt(r.headers['content-length'] || '0', 10) || 0, sources: [...srcs].slice(0, 5) }); } }));

  // pemeriksaan tingkat situs
  const hc = model.hostChecks;
  if (start.protocol === 'https:') {
    const r = await H.request('http://' + start.host + '/', { timeout: 10000, wantBody: false });
    hc.httpToHttps = { status: r.status, location: r.location, error: r.error };
  } else hc.httpsMissing = true;
  const alt = start.hostname.startsWith('www.') ? start.hostname.slice(4) : 'www.' + start.hostname;
  if (!H.isPrivateHost(start.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(start.hostname)) { const r = await H.request(start.protocol + '//' + alt + (start.port ? ':' + start.port : '') + '/', { timeout: 10000, wantBody: false }); hc.hostVariant = { host: alt, status: r.status, location: r.location, error: r.error }; }
  const rnd = Math.random().toString(36).slice(2, 10), s4 = await H.request(origin + '/audit-uji-404-' + rnd, { timeout: 10000, wantBody: false });
  hc.soft404 = { status: s4.status };

  // serialisasi
  model.pages = model.pages.map(p => ({ ...p, inlinks: [...p.inlinks].slice(0, 200), inlinkCount: p.inlinks.size, headers: p.headers ? pickHeaders(p.headers) : undefined }));
  model.fetched = fetched; model.finishedAt = new Date().toISOString();
  return model;
}
const KEEP = ['server', 'x-powered-by', 'content-encoding', 'cache-control', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy', 'referrer-policy', 'x-robots-tag', 'last-modified', 'set-cookie', 'content-length'];
const pickHeaders = h => Object.fromEntries(KEEP.filter(k => h[k] !== undefined).map(k => [k, k === 'set-cookie' ? String(h[k]).slice(0, 80) : h[k]]));
module.exports = { crawlSite, lean, pickHeaders, isHtml, fetchSitemaps, fetchLlms };
