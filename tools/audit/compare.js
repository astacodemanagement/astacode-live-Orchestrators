'use strict';
// Analisis banding situs sendiri vs kompetitor: skor, posisi, celah (gap), kekuatan, celah topik konten, dan rekomendasi yang bisa didelegasikan.
// Semua dari data publik (sitemap, sampel halaman, robots.txt, PageSpeed). Tidak ada data berbayar (volume keyword, backlink, trafik).
const num = v => typeof v === 'number' && isFinite(v);
const clampN = v => Math.max(0, Math.min(100, Math.round(v)));
const rel = (v, max) => num(v) && max > 0 ? clampN(100 * v / max) : null;
const SAFE_TERM = /^[a-z0-9]+( [a-z0-9]+)?$/;

const wavg = parts => { const ok = parts.filter(p => p[0] != null); return ok.length ? Math.round(ok.reduce((a, p) => a + p[0] * p[1], 0) / ok.reduce((a, p) => a + p[1], 0)) : null; };
const speedOf = (i, s) => i.psi && i.psi[s] && num(i.psi[s].perf) ? i.psi[s].perf : null;
const aiComp = (i, id) => { const c = i.ai && i.ai.components && i.ai.components.find(x => x.id === id); return c ? c.score : null; };

// Definisi celah: ambang selisih dan saran perbaikan. domain = agent bidang mana yang cocok (lihat plan.js).
const GAPS = [
  { k: 'onpage', label: 'Skor SEO on-page (sampel halaman)', get: i => i.metrics && i.metrics.onpageScore, thr: 8, domain: 'content', fmt: v => v + '/100',
    fix: 'Lengkapi judul 30–60 karakter, meta description, H1, canonical, Open Graph, dan schema di halaman penting sampai setara atau lebih baik dari kompetitor.' },
  { k: 'ai', label: 'AI Search Health', get: i => i.ai && i.ai.score, thr: 8, domain: 'technical', fmt: v => v + '/100',
    fix: 'Tingkatkan kesiapan AI Search: izinkan crawler AI, lengkapi schema, rapikan struktur konten, tambahkan FAQ dan penulis. Lihat rincian komponen di tab Audit Situs.' },
  { k: 'ai_schema', label: 'AI · Data terstruktur (schema)', get: i => aiComp(i, 'schema'), thr: 15, domain: 'technical', fmt: v => v + '/100', fix: 'Tambahkan Organization/WebSite, Article/Service, BreadcrumbList, dan FAQPage JSON-LD yang valid.' },
  { k: 'ai_access', label: 'AI · Akses crawler AI', get: i => aiComp(i, 'access'), thr: 15, domain: 'technical', fmt: v => v + '/100', fix: 'Periksa robots.txt: izinkan OAI-SearchBot, PerplexityBot, Claude-SearchBot, Bingbot, Googlebot.' },
  { k: 'ai_structure', label: 'AI · Struktur konten mudah dikutip', get: i => aiComp(i, 'structure'), thr: 15, domain: 'content', fmt: v => v + '/100', fix: 'Perkuat subjudul H2, jawaban langsung di paragraf pembuka, daftar/tabel, dan bagian FAQ.' },
  { k: 'ai_entity', label: 'AI · Entitas & kepercayaan', get: i => aiComp(i, 'entity'), thr: 15, domain: 'content', fmt: v => v + '/100', fix: 'Tambahkan sameAs, halaman Tentang/Kontak, dan nama penulis di artikel.' },
  { k: 'speedM', label: 'Kecepatan mobile (PageSpeed)', get: i => speedOf(i, 'mobile'), thr: 8, domain: 'speed', fmt: v => v + '/100', fix: 'Optimalkan gambar, tunda JavaScript, aktifkan cache/CDN, dan kurangi skrip pihak ketiga agar skor mobile mengejar kompetitor.' },
  { k: 'speedD', label: 'Kecepatan desktop (PageSpeed)', get: i => speedOf(i, 'desktop'), thr: 8, domain: 'speed', fmt: v => v + '/100', fix: 'Periksa respons server, ukuran aset, dan skrip yang memblokir render.' },
  { k: 'words', label: 'Kedalaman konten (median kata)', get: i => i.metrics && i.metrics.medianWords, ratio: 0.7, minBest: 300, domain: 'content', fmt: v => v + ' kata', fix: 'Perdalam halaman utama dengan konten yang menjawab kebutuhan pencari secara lengkap (contoh, data, FAQ), setara kedalaman kompetitor.' },
  { k: 'fresh', label: 'Frekuensi pembaruan (30 hari, lastmod)', get: i => i.sitemap && i.sitemap.updated30, ratio: 0.5, minBest: 3, domain: 'content', fmt: v => v + ' halaman', fix: 'Buat jadwal terbit dan pembaruan rutin, serta isi lastmod yang akurat di sitemap.' },
  { k: 'size', label: 'Jumlah halaman di sitemap', get: i => i.sitemap && i.sitemap.urls, ratio: 0.5, minBest: 20, domain: 'content', fmt: v => v + ' halaman', fix: 'Perluas cakupan topik: buat halaman layanan/artikel baru untuk topik yang sudah dibahas kompetitor (lihat Celah topik).' },
  { k: 'ttfb', label: 'Respons server (median)', get: i => i.metrics && i.metrics.medianTtfb, lower: true, factor: 1.5, minDiff: 200, domain: 'speed', fmt: v => v + ' ms', fix: 'Aktifkan cache halaman, optimalkan query dan konfigurasi server agar respons secepat kompetitor.' },
];

function analyze(items) {
  const ok = items.filter(i => i.ok), self = items.find(i => i.self), comps = ok.filter(i => !i.self);
  const maxOf = f => Math.max(0, ...ok.map(i => f(i)).filter(num));
  const maxWords = maxOf(i => i.metrics && i.metrics.medianWords), maxFresh = maxOf(i => i.sitemap && i.sitemap.updated30), maxFresh90 = maxOf(i => i.sitemap && i.sitemap.updated90);
  const scores = {};
  for (const i of items) {
    if (!i.ok) { scores[i.domain] = null; continue; }
    const m = i.metrics || {}, sm = speedOf(i, 'mobile'), sd = speedOf(i, 'desktop');
    const fresh = maxFresh > 0 ? rel(i.sitemap && i.sitemap.updated30, maxFresh) : maxFresh90 > 0 ? rel(i.sitemap && i.sitemap.updated90, maxFresh90) : null;
    const sc = { onpage: num(m.onpageScore) ? m.onpageScore : null, ai: i.ai ? i.ai.score : null, speedMobile: sm, speedDesktop: sd, depth: rel(m.medianWords, maxWords), fresh };
    sc.overall = wavg([[sc.onpage, 25], [sc.ai, 25], [sm, 12], [sd, 8], [sc.depth, 15], [sc.fresh, 15]]);
    scores[i.domain] = sc;
  }
  const ranked = ok.filter(i => scores[i.domain] && scores[i.domain].overall != null).sort((a, b) => scores[b.domain].overall - scores[a.domain].overall);
  const rank = self && ranked.includes(self) ? { pos: ranked.indexOf(self) + 1, of: ranked.length } : null;

  const gaps = [], strengths = [];
  if (self && self.ok && comps.length) for (const g of GAPS) {
    const sv = g.get(self); if (!num(sv)) continue;
    const others = comps.map(c => ({ c, v: g.get(c) })).filter(x => num(x.v)); if (!others.length) continue;
    const best = others.reduce((a, b) => (g.lower ? b.v < a.v : b.v > a.v) ? b : a);
    let behind = false, diff = 0;
    if (g.lower) { behind = sv > best.v * g.factor && sv - best.v > g.minDiff; diff = Math.round(100 * (sv - best.v) / Math.max(1, best.v)); }
    else if (g.thr != null) { behind = best.v - sv >= g.thr; diff = best.v - sv; }
    else { behind = best.v >= g.minBest && sv < best.v * g.ratio; diff = Math.round(100 * (best.v - sv) / Math.max(1, best.v)); }
    if (behind) gaps.push({ key: g.k, label: g.label, self: sv, best: best.v, bestName: best.c.name, diff, domain: g.domain, fix: g.fix, selfTxt: g.fmt(sv), bestTxt: g.fmt(best.v), lower: !!g.lower });
    else if (g.lower ? sv <= best.v : sv > best.v && (g.thr == null || sv - best.v >= 1)) strengths.push({ key: g.k, label: g.label, self: sv, selfTxt: g.fmt(sv), second: best.v, secondTxt: g.fmt(best.v) });
  }
  gaps.sort((a, b) => b.diff - a.diff);

  // celah topik: istilah yang sering muncul di kompetitor tetapi tidak ada di situs sendiri
  const selfT = new Map((self && self.topics || []).map(t => [t.t, t])), selfUni = new Set([...selfT.keys()].flatMap(t => t.split(' ')));
  const agg = new Map();
  for (const c of comps) for (const t of c.topics || []) {
    if (!SAFE_TERM.test(t.t)) continue;
    const parts = t.t.split(' '), missing = parts.length === 1 ? !selfUni.has(t.t) && !selfT.has(t.t) : !selfT.has(t.t) && parts.some(p => !selfUni.has(p));
    if (!missing) continue;
    const a = agg.get(t.t) || agg.set(t.t, { t: t.t, n: 0, comps: new Map() }).get(t.t); a.n += t.n; if (!a.comps.has(c.name)) a.comps.set(c.name, t.url);
  }
  const need = comps.length >= 3 ? 2 : 1;
  const cand = [...agg.values()].filter(a => a.comps.size >= need && a.n >= 3).sort((a, b) => (b.comps.size * 10 + b.n) - (a.comps.size * 10 + a.n));
  // buang kata tunggal yang sudah terwakili frasa yang lebih spesifik (mis. "mobile" bila "aplikasi mobile" ada)
  const phrases = cand.filter(a => a.t.includes(' ')), topicGap = cand.filter(a => a.t.includes(' ') || !phrases.some(p => p.t.split(' ').includes(a.t) && p.n >= 0.6 * a.n && p.comps.size >= a.comps.size)).slice(0, 30)
    .map(a => ({ t: a.t, n: a.n, comps: [...a.comps.keys()], examples: [...a.comps.entries()].slice(0, 3).map(([name, url]) => ({ name, url })) }));

  // rekomendasi (format sama dengan plan.js)
  const recs = [];
  for (const g of gaps.filter(x => x.key !== 'ai').slice(0, 6)) {   // skor AI gabungan tidak dijadikan rekomendasi sendiri: komponennya sudah ada
    const sev = g.diff >= 20 ? 'warning' : 'notice', pr = (sev === 'warning' ? 60 : 25) + Math.min(40, g.diff);
    recs.push({ id: 'rec:cmp:' + g.key, issueId: 'cmp_' + g.key, source: 'competitor', title: 'Kalah dari kompetitor: ' + g.label, why: 'Situs Anda ' + g.selfTxt + ' sedangkan terbaik ' + g.bestTxt + ' (' + g.bestName + ').', fix: g.fix,
      severity: sev, category: 'competitor', domain: g.domain, count: 1, urls: [], notes: [], impact: pr >= 90 ? 'tinggi' : pr >= 50 ? 'sedang' : 'rendah', effort: g.domain === 'speed' ? 'tinggi' : 'sedang', quick: false, priority: Math.round(pr) });
  }
  if (topicGap.length >= 3) { const top = topicGap.slice(0, 12);
    recs.push({ id: 'rec:cmp:topics', issueId: 'cmp_topics', source: 'competitor', title: 'Celah topik: ' + topicGap.length + ' topik dibahas kompetitor tetapi belum ada di situs Anda', why: 'Kompetitor sudah punya halaman untuk topik ini, sedangkan situs Anda belum. Ini peluang trafik yang bisa direbut.',
      fix: 'Pilih topik yang relevan dengan layanan Anda, buat halaman layanan atau artikel yang lebih lengkap dan lebih baru dari kompetitor, lalu tautkan dari halaman terkait.', severity: 'warning', category: 'competitor', domain: 'content', count: topicGap.length, urls: [], notes: [], topics: top.map(t => t.t),
      impact: 'tinggi', effort: 'tinggi', quick: false, priority: 95 }); }
  return { scores, rank, gaps, strengths, topicGap, recs, selfName: self ? self.name : null };
}
module.exports = { analyze, GAPS };
