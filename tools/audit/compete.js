'use strict';
// Pemantau kompetitor dari DATA PUBLIK saja: sitemap, beberapa halaman sampel, teknologi, dan perubahan dari waktu ke waktu.
// Patuh robots.txt, kecepatan dibatasi, dan tidak memakai data berbayar (volume keyword / backlink / trafik tidak tersedia).
const H = require('./http');
const { parseHtml } = require('./html');
const { lean, fetchSitemaps, fetchLlms } = require('./crawl');
const AI = require('./ai');

const TECH = [
  ['WordPress', (h, b) => /wp-content|wp-includes|wp-json/i.test(b)], ['Next.js', (h, b) => /\/_next\/|__NEXT_DATA__/.test(b)], ['Nuxt', (h, b) => /__NUXT__|\/_nuxt\//.test(b)],
  ['Laravel', (h) => /laravel_session|XSRF-TOKEN/.test(h['set-cookie'] || '')], ['Shopify', (h, b) => /cdn\.shopify\.com/i.test(b)], ['Wix', (h, b) => /wixstatic\.com|static\.parastorage/i.test(b)],
  ['Webflow', (h, b) => /webflow/i.test(b)], ['Elementor', (h, b) => /elementor/i.test(b)], ['Bootstrap', (h, b) => /bootstrap(\.min)?\.(css|js)/i.test(b)], ['jQuery', (h, b) => /jquery(\.min)?\.js/i.test(b)],
  ['Google Tag Manager', (h, b) => /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(b)], ['Google Analytics', (h, b) => /gtag\/js\?id=G-|google-analytics\.com\/analytics\.js/.test(b)],
  ['Meta Pixel', (h, b) => /connect\.facebook\.net[^"']*fbevents|fbq\(/.test(b)], ['Hotjar', (h, b) => /static\.hotjar\.com/.test(b)],
  ['Cloudflare', (h) => /cloudflare/i.test(h.server || '') || !!h['cf-ray']], ['Nginx', (h) => /nginx/i.test(h.server || '')], ['Apache', (h) => /apache/i.test(h.server || '')],
  ['LiteSpeed', (h) => /litespeed/i.test(h.server || '')], ['PHP', (h) => /php/i.test(h['x-powered-by'] || '')], ['Vercel', (h) => /vercel/i.test(h.server || '') || !!h['x-vercel-id']], ['Netlify', (h) => /netlify/i.test(h.server || '')],
];
const detectTech = (headers, html) => TECH.filter(([, f]) => { try { return f(headers || {}, html || ''); } catch (_) { return false; } }).map(t => t[0]);
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (n, d) => d ? Math.round(100 * n / d) : null;
const daysAgo = iso => { const t = Date.parse(iso); return isNaN(t) ? null : (Date.now() - t) / 864e5; };


// ---- topik: kata dan frasa dari slug URL sitemap + judul/H1/H2 halaman sampel (tanpa data berbayar)
const STOP = new Set(('yang dan di ke dari untuk dengan pada adalah ini itu atau dalam akan juga para oleh sebagai bagi tidak ada kami kita anda saya apa cara tips blog page pages halaman kategori category tag tags author feed amp wp content uploads archive index home html php htm aspx the and for with how what your you our of to in on is are post posts www com net org id co new best top about contact tentang kontak berita news artikel read more terbaru lengkap mereka telah berbagai berpengalaman mudah client clients project projects work works portfolio portofolio product products solution solutions service services lainnya semua setiap lebih sangat dapat bisa hanya bagaimana apakah kenapa mengapa siapa kapan dimana berapa faq langkah praktis manfaat panduan kerjanya cara-kerja selengkapnya klik disini lihat baca semua kami-kita').split(' '));
// Kata umum: boleh menjadi bagian frasa ("jasa seo") tetapi tidak dihitung sebagai topik sendiri ("jasa").
const GENERIC = new Set('jasa layanan profesional terbaik murah terpercaya harga paket solusi kualitas online digital indonesia terbaru bisnis perusahaan company pembuatan pengertian contoh jenis fungsi'.split(' '));
const norm1 = t => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
function tokens(text) { return norm1(String(text || '')).split(/[^a-z0-9]+/).filter(Boolean); }
function addTerms(map, toks, url) {
  const uni = toks.filter(t => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t) && !GENERIC.has(t)), seen = new Set();
  const put = k => { if (seen.has(k)) return; seen.add(k); const e = map.get(k) || map.set(k, { n: 0, url }).get(k); e.n++; };
  for (const t of uni) put(t);
  for (let i = 0; i + 1 < toks.length; i++) { const a = toks[i], b = toks[i + 1]; if (a.length >= 3 && b.length >= 3 && !STOP.has(a) && !STOP.has(b) && !/^\d+$/.test(a) && !/^\d+$/.test(b) && !(GENERIC.has(a) && GENERIC.has(b))) put(a + ' ' + b); }
}
function extractTopics(entries, sample, domain) {
  const map = new Map();
  for (const e of entries) { let p; try { const u = new URL(e.loc); if (H.stripWww(u.host) !== domain) continue; p = decodeURIComponent(u.pathname); } catch (_) { continue; }
    for (const seg of p.split('/').filter(Boolean)) addTerms(map, tokens(seg), e.loc); }
  for (const r of sample) addTerms(map, tokens([r.title, r.h1, ...(r.h2 || [])].join(' . ').replace(/\./g, ' ')), r.url);
  return [...map.entries()].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 400).map(([t, v]) => ({ t, n: v.n, url: v.url }));
}

async function snapshotSite(baseUrl, { maxSample = 20, delayMs = 1500, log = () => {} } = {}) {
  const u = new URL(baseUrl), origin = u.origin, limiter = new H.Limiter(delayMs);
  const snap = { domain: H.stripWww(u.host), url: origin, fetchedAt: new Date().toISOString(), ok: false, blocked: false, error: null, robots: {}, sitemap: { urls: 0, files: 0, truncated: false, entries: [], updated7: 0, updated30: 0, updated90: 0 }, home: null, sample: [], tech: [], metrics: {}, ai: null, topics: [] };
  const rr = await H.request(origin + '/robots.txt', { timeout: 10000, forceText: true });
  const robotsText = rr.status === 200 ? String(rr.body || '') : '', robots = new H.Robots(robotsText);
  snap.robots = { status: rr.error ? 0 : rr.status, blocksAll: robots.blocksAll(), sitemaps: robots.sitemaps.length };
  if (robots.delay()) limiter.minMs = Math.max(limiter.minMs, robots.delay() * 1000);
  const llms = await fetchLlms(origin); snap.llms = { found: llms.found, links: llms.links };
  const sm = await fetchSitemaps(origin, robots, true, limiter, log);
  const entries = sm.urls.slice(0, 5000); snap.sitemap = { urls: sm.urls.length, files: sm.files.length, truncated: sm.urls.length > 5000, found: sm.found, entries, updated7: 0, updated30: 0, updated90: 0 };
  const lmi = AI.lastmodInfo(entries); snap.sitemap.lastmodUniform = lmi.uniform;
  if (lmi.reliable) for (const e of entries) { const d = e.lastmod ? daysAgo(e.lastmod) : null; if (d != null && d <= 7) snap.sitemap.updated7++; if (d != null && d <= 30) snap.sitemap.updated30++; if (d != null && d <= 90) snap.sitemap.updated90++; }
  else { snap.sitemap.updated7 = snap.sitemap.updated30 = snap.sitemap.updated90 = null; }   // lastmod seragam: tidak bisa dipakai menilai frekuensi pembaruan
  snap.topics = extractTopics(entries, [], snap.domain);
  if (snap.robots.blocksAll) { snap.blocked = true; snap.error = 'robots.txt melarang crawler; hanya sitemap yang dibaca'; snap.ok = entries.length > 0; return finish(snap); }

  const h = await H.fetchChain(origin + '/', {}, limiter), f = h.final;
  if (f.status !== 200 || !f.body) { snap.error = f.error ? 'beranda gagal dibuka: ' + f.error : 'beranda status ' + f.status; snap.ok = entries.length > 0; return finish(snap); }
  const hp = parseHtml(f.body), hd = f.headers || {};
  snap.home = { url: h.finalUrl, ...lean(hp), ttfb: f.ttfb, headers: { server: hd.server || null }, https: h.finalUrl.startsWith('https:'), hsts: !!hd['strict-transport-security'], compressed: /gzip|br|deflate|zstd/.test(hd['content-encoding'] || '') };
  snap.tech = detectTech(hd, f.body);
  const own = x => { try { return H.stripWww(new URL(x).host) === snap.domain; } catch (_) { return false; } };
  let cand = entries.filter(e => own(e.loc)).map(e => ({ url: e.loc, lastmod: e.lastmod || null }));
  if (!cand.length) cand = [...new Set(hp.links.map(l => H.norm(l.href, h.finalUrl)).filter(x => x && own(x)))].map(x => ({ url: x, lastmod: null }));
  cand = cand.filter(c => c.url !== h.finalUrl && c.url.replace(/\/$/, '') !== origin);
  // Sampel seimbang: separuh halaman paling baru diperbarui, separuh tersebar merata di seluruh sitemap (supaya tidak bias ke blog saja).
  const byNew = [...cand].sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || '')), want = Math.max(0, maxSample - 1), nNew = Math.ceil(want / 2), pick = byNew.slice(0, nNew), rest = byNew.slice(nNew);
  if (rest.length && want > nNew) { const k = want - nNew, step = rest.length / k; for (let i = 0; i < k && Math.floor(i * step) < rest.length; i++) pick.push(rest[Math.floor(i * step)]); }
  const rows = [{ url: h.finalUrl, lastmod: null, parsed: snap.home, ttfb: f.ttfb, home: true }];
  for (const c of pick) {
    if (!robots.allowed(c.url)) continue;
    await limiter.wait(c.url); const r = await H.request(c.url, { timeout: 15000 });
    if (r.status === 200 && r.body && /html/.test(r.contentType)) rows.push({ url: c.url, lastmod: c.lastmod, parsed: lean(parseHtml(r.body)), ttfb: r.ttfb });
  }
  snap.sample = rows.map(r => { const x = r.parsed, qh = (x.h2texts || []).some(t => /\?\s*$|^(apa|apakah|bagaimana|kenapa|mengapa|siapa|kapan|berapa|cara|what|how|why|when|who)\b/i.test(t));
    return { url: r.url, lastmod: r.lastmod, title: x.title || '', meta: x.metaDescription || '', h1: (x.h1 || [])[0] || '', h2: (x.h2texts || []).slice(0, 6), words: x.wordCount, h2n: x.h2 || 0, schema: x.jsonldTypes || [], ttfb: r.ttfb, og: !!x.ogTitle, canonical: !!x.canonical, viewport: !!x.viewport,
      list: (x.lists || 0) + (x.tables || 0) > 0, question: qh, author: !!(x.authorMeta || x.relAuthor || (x.jsonld && x.jsonld.author)), dated: !!(x.published || x.modified || x.times > 0 || (x.jsonld && (x.jsonld.datePublished || x.jsonld.dateModified))), home: !!r.home }; });
  snap.topics = extractTopics(entries, snap.sample, snap.domain);
  snap.ai = (({ score, components, blockedBots, pagesAssessed }) => ({ score, components: components.map(c => ({ id: c.id, label: c.label, weight: c.weight, score: c.score, status: c.status, detail: c.detail })), blockedBots, pagesAssessed }))(
    AI.assess({ pages: rows.map(r => ({ url: r.url, parsed: r.parsed })), robotsText, robotsStatus: snap.robots.status, llms, sitemapEntries: entries, allUrls: [...entries.map(e => e.loc), ...rows.map(r => r.url)], origin, homeUrl: h.finalUrl }));
  snap.ok = true; return finish(snap);
}
function finish(snap) {
  const s = snap.sample, n = s.length;
  snap.metrics = { sampleSize: n, sitemapUrls: snap.sitemap.urls, updated7: snap.sitemap.updated7, updated30: snap.sitemap.updated30, updated90: snap.sitemap.updated90,
    medianWords: med(s.map(x => x.words).filter(x => x != null)), titleOkPct: pct(s.filter(x => x.title.length >= 30 && x.title.length <= 60).length, n), metaPct: pct(s.filter(x => x.meta).length, n),
    h1Pct: pct(s.filter(x => x.h1).length, n), schemaPct: pct(s.filter(x => x.schema.length).length, n), ogPct: pct(s.filter(x => x.og).length, n), canonicalPct: pct(s.filter(x => x.canonical).length, n), viewportPct: pct(s.filter(x => x.viewport).length, n),
    avgH2: n ? Math.round(10 * s.reduce((a, x) => a + (x.h2n || 0), 0) / n) / 10 : null, questionPct: pct(s.filter(x => x.question).length, n), authorPct: pct(s.filter(x => x.author).length, n), datedPct: pct(s.filter(x => x.dated).length, n),
    faqPct: pct(s.filter(x => x.schema.includes('FAQPage')).length, n), medianTtfb: med(s.map(x => x.ttfb).filter(x => x != null)) };
  const m = snap.metrics, parts = [[m.titleOkPct, 14], [m.metaPct, 14], [m.h1Pct, 12], [m.canonicalPct, 12], [m.ogPct, 10], [m.schemaPct, 18], [m.viewportPct, 10], [snap.home && snap.home.https ? 100 : 0, 10]].filter(x => x[0] != null);
  m.onpageScore = parts.length ? Math.round(parts.reduce((a, x) => a + x[0] * x[1], 0) / parts.reduce((a, x) => a + x[1], 0)) : null;   // skor SEO on-page dari sampel
  snap.sample.forEach(x => { delete x.h2; });   // judul H2 hanya dipakai untuk ekstraksi topik; tidak perlu disimpan
  return snap;
}

// Perbarui state per domain: halaman baru (dari selisih sitemap), URL hilang, perubahan judul/meta/H1, dan riwayat metrik.
function updateState(state, snap) {
  const now = snap.fetchedAt, d = state.domains[snap.domain] || (state.domains[snap.domain] = { firstSnapshot: now, initialised: false, firstSeen: {}, pages: {}, changes: [], newPages: [], history: [] });
  const out = { isFirst: !d.initialised, newUrls: [], removed: [], changes: [] };
  const entries = snap.sitemap.entries || [], current = new Set(entries.map(e => e.loc));
  if (entries.length) {
    for (const e of entries) if (!(e.loc in d.firstSeen)) { d.firstSeen[e.loc] = out.isFirst ? null : now; if (!out.isFirst) out.newUrls.push({ url: e.loc, lastmod: e.lastmod || null, firstSeen: now }); }
    if (!snap.sitemap.truncated) for (const u of Object.keys(d.firstSeen)) if (!current.has(u)) { out.removed.push(u); delete d.firstSeen[u]; }
  }
  for (const p of snap.sample) { const prev = d.pages[p.url];
    if (prev) for (const f of ['title', 'meta', 'h1']) if ((prev[f] || '') !== (p[f] || '')) out.changes.push({ url: p.url, field: f, from: prev[f] || '', to: p[f] || '', date: now });
    d.pages[p.url] = { title: p.title, meta: p.meta, h1: p.h1, words: p.words }; }
  d.changes = [...out.changes, ...d.changes].slice(0, 100); d.newPages = [...out.newUrls, ...(d.newPages || [])].slice(0, 200);
  d.initialised = true;
  const row = { date: now.slice(0, 10), sitemap: snap.sitemap.urls, new: out.newUrls.length, medianWords: snap.metrics.medianWords, updated30: snap.metrics.updated30, onpage: snap.metrics.onpageScore, ai: snap.ai ? snap.ai.score : null };
  d.history = [...d.history.filter(h => h.date !== row.date), row].slice(-180);
  d.pageCount = Object.keys(d.pages).length;
  return out;
}
const new30 = d => Object.values(d.firstSeen || {}).filter(v => v && daysAgo(v) <= 30).length;
const new7 = d => Object.values(d.firstSeen || {}).filter(v => v && daysAgo(v) <= 7).length;
module.exports = { snapshotSite, updateState, detectTech, new30, new7 };
