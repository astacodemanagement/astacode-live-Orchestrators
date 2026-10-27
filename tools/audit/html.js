'use strict';
// Pengurai HTML ringan tanpa dependensi: cukup toleran untuk audit SEO (title, meta, heading, link, gambar, JSON-LD, dsb).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch (_) { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseAttrs(str) {
  const a = {}; let m; ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(str))) { const k = m[1].toLowerCase(); if (!(k in a)) a[k] = decode(m[2] ?? m[3] ?? m[4] ?? ''); }
  return a;
}
const clean = t => decode(t).replace(/\s+/g, ' ').trim();
function collectTypes(o, set, info) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(x => collectTypes(x, set, info)); return; }
  const t = o['@type']; if (typeof t === 'string') set.add(t); else if (Array.isArray(t)) t.forEach(x => typeof x === 'string' && set.add(x));
  if (info) {
    if (o.sameAs && (!Array.isArray(o.sameAs) || o.sameAs.length)) info.sameAs++;
    if (o.author) info.author = true; if (o.datePublished) info.datePublished = true; if (o.dateModified) info.dateModified = true;
    if (o.logo) info.logo = true; if (o.telephone || o.address || o.contactPoint) info.contact = true;
    if (o.aggregateRating || o.review) info.rating = true;
  }
  if (o['@graph']) collectTypes(o['@graph'], set, info);
  if (info) for (const k of ['mainEntity', 'publisher', 'author', 'isPartOf']) if (o[k] && typeof o[k] === 'object') collectTypes(o[k], set, info);
}

function parseHtml(html) {
  const out = {
    title: null, titleCount: 0, metaDescription: null, metaDescriptionCount: 0, robots: '', canonical: null, canonicalCount: 0, lang: null,
    viewport: false, charset: false, h1: [], h2: 0, h3: 0, images: [], links: [], resources: [], og: {}, twitter: {}, hreflang: [],
    jsonldTypes: [], jsonldBlocks: 0, jsonldErrors: 0, jsonld: { sameAs: 0, author: false, datePublished: false, dateModified: false, logo: false, contact: false, rating: false },
    h2texts: [], h3texts: [], lists: 0, tables: 0, times: 0, authorMeta: null, published: null, modified: null, relAuthor: false, wordCount: 0, generator: null, scriptCount: 0, scriptSrcs: [], baseHref: null,
  };
  const n = html.length; let i = 0, inBody = !/<body[\s>]/i.test(html), cap = null;
  const types = new Set(), cap2 = 30;
  const addWords = t => { if (inBody) { const w = t.trim(); if (w) out.wordCount += w.split(/\s+/).length; } };
  const rawEnd = (name, from) => { const re = new RegExp('</' + name + '\\s*>', 'ig'); re.lastIndex = from; const m = re.exec(html); return m ? { start: m.index, end: m.index + m[0].length } : { start: n, end: n }; };
  while (i < n) {
    const lt = html.indexOf('<', i);
    const chunk = html.slice(i, lt < 0 ? n : lt);
    if (chunk) { if (cap) cap.buf += chunk; if (!inBody) { /* teks di head tidak dihitung */ } else addWords(decode(chunk)); }
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 60));
    if (!m) { i = lt + 1; continue; }
    let j = lt + m[0].length, q = null;
    while (j < n && j - lt < 20000) { const c = html[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    if (j >= n || j - lt >= 20000) { j = html.indexOf('>', lt); if (j < 0) j = n; }
    const attrStr = html.slice(lt + m[0].length, j); i = j + 1;
    const closing = m[1] === '/', name = m[2].toLowerCase();
    if (closing) {
      if (cap && cap.tag === name) {
        const t = clean(cap.buf);
        if (name === 'title') { if (!inBody) { out.titleCount++; if (out.title === null) out.title = t; } }
        else if (name === 'h1') out.h1.push(t);
        else if (name === 'h2') { if (out.h2texts.length < cap2) out.h2texts.push(t.slice(0, 120)); }
        else if (name === 'h3') { if (out.h3texts.length < cap2) out.h3texts.push(t.slice(0, 120)); }
        cap = null;
      }
      continue;
    }
    const a = parseAttrs(attrStr);
    switch (name) {
      case 'html': out.lang = a.lang || out.lang; break;
      case 'body': inBody = true; break;
      case 'base': if (a.href) out.baseHref = a.href; break;
      case 'title': if (!inBody) cap = { tag: 'title', buf: '' }; break;
      case 'h1': cap = { tag: 'h1', buf: '' }; break;
      case 'h2': out.h2++; cap = { tag: 'h2', buf: '' }; break;
      case 'h3': out.h3++; cap = { tag: 'h3', buf: '' }; break;
      case 'ul': case 'ol': out.lists++; break;
      case 'table': out.tables++; break;
      case 'time': out.times++; if (a.datetime && !out.published) out.published = a.datetime; break;
      case 'meta': {
        const nm = (a.name || a.property || '').toLowerCase(), http = (a['http-equiv'] || '').toLowerCase();
        if (a.charset || http === 'content-type') out.charset = true;
        if (nm === 'description') { out.metaDescriptionCount++; if (out.metaDescription === null) out.metaDescription = clean(a.content || ''); }
        else if (nm === 'robots' || nm === 'googlebot') out.robots += ' ' + (a.content || '').toLowerCase();
        else if (nm === 'viewport') out.viewport = true;
        else if (nm === 'generator') out.generator = a.content || null;
        else if (nm === 'author') out.authorMeta = a.content || null;
        else if (nm === 'article:published_time' || nm === 'datepublished' || nm === 'date') out.published = out.published || a.content || null;
        else if (nm === 'article:modified_time' || nm === 'og:updated_time' || nm === 'datemodified' || nm === 'last-modified') out.modified = out.modified || a.content || null;
        else if (nm.startsWith('og:')) out.og[nm.slice(3)] = a.content || '';
        else if (nm.startsWith('twitter:')) out.twitter[nm.slice(8)] = a.content || '';
        break; }
      case 'link': {
        const rel = (a.rel || '').toLowerCase().split(/\s+/);
        if (rel.includes('canonical')) { out.canonicalCount++; if (out.canonical === null) out.canonical = a.href || ''; }
        else if (rel.includes('alternate') && a.hreflang) out.hreflang.push({ lang: a.hreflang, href: a.href || '' });
        else if (rel.includes('author')) out.relAuthor = true;
        else if (rel.includes('stylesheet') && a.href) out.resources.push({ type: 'css', url: a.href });
        break; }
      case 'a': if (a.href !== undefined) out.links.push({ href: a.href, rel: (a.rel || '').toLowerCase() }); break;
      case 'img': out.images.push({ src: a.src || a['data-src'] || '', hasAlt: 'alt' in a, alt: a.alt || '' }); if (a.src) out.resources.push({ type: 'img', url: a.src }); break;
      case 'iframe': case 'source': case 'video': case 'audio': case 'embed': if (a.src) out.resources.push({ type: name, url: a.src }); break;
      case 'script': {
        out.scriptCount++; const e = rawEnd('script', i), text = html.slice(i, e.start); i = e.end;
        if (a.src) { out.resources.push({ type: 'script', url: a.src }); out.scriptSrcs.push(a.src); }
        if ((a.type || '').toLowerCase().includes('ld+json')) {
          out.jsonldBlocks++;
          try { collectTypes(JSON.parse(text.trim()), types, out.jsonld); } catch (_) { out.jsonldErrors++; }
        }
        break; }
      case 'style': { const e = rawEnd('style', i); i = e.end; break; }
      default: break;
    }
  }
  out.jsonldTypes = [...types];
  return out;
}
module.exports = { parseHtml, decode, clean };
