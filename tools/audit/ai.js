'use strict';
// AI Search Health: seberapa siap situs dikutip oleh mesin pencari berbasis AI (Google AI Overviews, ChatGPT Search, Perplexity, Claude, Copilot).
// PENTING: ini penilaian HEURISTIK dari praktik terbaik yang diketahui publik, bukan metrik resmi dari Google/OpenAI/dsb.
// Tiap komponen transparan (bobot, nilai, alasan) supaya mudah dicek dan diperbaiki. Dipakai untuk situs sendiri dan kompetitor.
const H = require('./http');

// [token user-agent, nama tampil, peran, bobot]. "ambil" = bot yang mengambil halaman saat pengguna bertanya (paling penting untuk dikutip).
const BOTS = [
  ['oai-searchbot', 'OAI-SearchBot (ChatGPT Search)', 'ambil', 3], ['chatgpt-user', 'ChatGPT-User', 'ambil', 3], ['perplexitybot', 'PerplexityBot', 'ambil', 3],
  ['claude-searchbot', 'Claude-SearchBot', 'ambil', 3], ['claude-user', 'Claude-User', 'ambil', 2], ['bingbot', 'Bingbot (Copilot)', 'cari', 3], ['googlebot', 'Googlebot (AI Overviews)', 'cari', 3],
  ['gptbot', 'GPTBot (pelatihan OpenAI)', 'latih', 1], ['claudebot', 'ClaudeBot (pelatihan Anthropic)', 'latih', 1], ['google-extended', 'Google-Extended (Gemini)', 'latih', 1],
  ['applebot-extended', 'Applebot-Extended', 'latih', 1], ['ccbot', 'CCBot (Common Crawl)', 'latih', 1],
];
const QUESTION = /\?\s*$|^(apa|apakah|bagaimana|kenapa|mengapa|siapa|kapan|dimana|di mana|berapa|cara|what|how|why|when|who|where|which|can|does|is)\b/i;
const CONTENT_SCHEMA = /^(Article|BlogPosting|NewsArticle|Service|Product|LocalBusiness|ProfessionalService|FAQPage|HowTo|Course|SoftwareApplication|WebPage|ItemList|Review|Event|Offer)$/;
const ORG_SCHEMA = /^(Organization|LocalBusiness|ProfessionalService|Corporation|WebSite|Person|OnlineBusiness)$/;
const ENTITY_PATH = /(tentang|about|kontak|contact|profil|profile|tim|team|company|perusahaan)/i;
// Sitemap yang hampir semua lastmod-nya bertanggal sama biasanya dibuat otomatis (tanggal build), bukan tanggal perubahan konten sebenarnya.
function lastmodInfo(entries) {
  const lm = (entries || []).map(e => e.lastmod && String(e.lastmod).slice(0, 10)).filter(Boolean);
  if (lm.length < 20) return { reliable: lm.length > 0, uniform: false, share: 0, n: lm.length };
  const c = new Map(); for (const d of lm) c.set(d, (c.get(d) || 0) + 1); const share = Math.max(...c.values()) / lm.length;
  return { reliable: share < 0.8, uniform: share >= 0.8, share: Math.round(share * 100), n: lm.length };
}
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
const pc = (n, d) => d ? 100 * n / d : 0;
const status = s => s >= 80 ? 'good' : s >= 50 ? 'warn' : 'bad';
const daysAgo = iso => { const t = Date.parse(iso); return isNaN(t) ? null : (Date.now() - t) / 864e5; };
const short = (u, n = 60) => { try { const x = new URL(u); const s = x.pathname + x.search; return s.length > n ? s.slice(0, n - 1) + '…' : s; } catch (_) { return String(u); } };

// pages: [{url, parsed}] (halaman HTML 200 yang dapat diindeks) · robotsText · llms {found} · sitemapEntries [{loc,lastmod}] · allUrls [url]
function assess({ pages, robotsText = '', robotsStatus = 200, llms = null, sitemapEntries = [], allUrls = [], origin, homeUrl }) {
  const home = pages.find(p => p.url === homeUrl) || pages.find(p => { try { return new URL(p.url).pathname === '/'; } catch (_) { return false; } }) || null;
  const inner = pages.filter(p => p !== home), content = (inner.length ? inner : pages).filter(p => (p.parsed.wordCount || 0) >= 150);
  const base = content.length ? content : pages, items = {}, comps = [];
  const put = (id, label, weight, score, detail, fix) => comps.push({ id, label, weight, score: clamp(score), status: status(clamp(score)), detail, fix });

  // 1) akses bot AI di robots.txt
  const robots = new H.Robots(robotsStatus === 200 ? robotsText : ''), blocked = [], okBots = [];
  let tot = 0, got = 0;
  for (const [tok, name, role, w] of BOTS) { tot += w; const ok = robots.allowed((origin || 'https://x.test') + '/', tok) && !robots.blocksAll(tok); if (ok) { got += w; okBots.push(name); } else blocked.push({ name, role }); }
  const retrBlocked = blocked.filter(b => b.role !== 'latih');
  put('access', 'Akses crawler AI & mesin pencari', 22, pc(got, tot), blocked.length ? 'Diblokir di robots.txt: ' + blocked.map(b => b.name).join(', ') : 'Semua crawler AI dan mesin pencari utama diizinkan' + (robotsStatus === 200 ? '' : ' (robots.txt tidak ada, berarti terbuka)'),
    'Hapus aturan Disallow untuk crawler pencarian/pengambil (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Bingbot, Googlebot) agar situs bisa dikutip. Memblokir bot pelatihan (GPTBot, ClaudeBot, Google-Extended) adalah pilihan bisnis dan tidak menghalangi kutipan.');
  items.blocked = blocked; items.retrBlocked = retrBlocked;

  // 2) llms.txt
  put('llms', 'File llms.txt', 6, llms && llms.found ? 100 : 0, llms && llms.found ? 'llms.txt ditemukan' + (llms.links ? ' (' + llms.links + ' tautan)' : '') : 'llms.txt tidak ada',
    'Buat /llms.txt: ringkasan situs plus daftar tautan halaman terpenting (format Markdown). Catatan: ini usulan komunitas, belum standar resmi, dan belum dipastikan dipakai semua mesin AI.');

  // 3) data terstruktur
  const types = p => p.parsed.jsonldTypes || [];
  const homeOrg = !!home && types(home).some(t => ORG_SCHEMA.test(t));
  const innerPages = inner.length ? inner : pages;
  const withContent = innerPages.filter(p => types(p).some(t => CONTENT_SCHEMA.test(t))), withCrumb = innerPages.filter(p => types(p).includes('BreadcrumbList')), withAny = pages.filter(p => (p.parsed.jsonldBlocks || 0) > 0 && !(p.parsed.jsonldErrors > 0)), withFaq = pages.filter(p => types(p).includes('FAQPage'));
  const errs = pages.filter(p => p.parsed.jsonldErrors > 0);
  let sch = (homeOrg ? 28 : 0) + pc(withContent.length, innerPages.length) * 0.3 + pc(withCrumb.length, innerPages.length) * 0.12 + pc(withAny.length, pages.length) * 0.22 + (withFaq.length ? 8 : 0) - (errs.length ? 15 : 0);
  put('schema', 'Data terstruktur (schema.org)', 22, sch, 'Organization/WebSite di beranda: ' + (homeOrg ? 'ada' : 'belum') + ' · jenis konten: ' + withContent.length + '/' + innerPages.length + ' halaman · BreadcrumbList: ' + withCrumb.length + ' · FAQPage: ' + withFaq.length + (errs.length ? ' · JSON-LD rusak: ' + errs.length : ''),
    'Tambahkan JSON-LD: Organization + WebSite di beranda, jenis yang sesuai di tiap halaman (Article/Service/Product/LocalBusiness), BreadcrumbList, dan FAQPage untuk halaman tanya-jawab. Uji dengan Rich Results Test.');
  items.homeOrg = homeOrg; items.noContentSchema = innerPages.filter(p => !types(p).some(t => CONTENT_SCHEMA.test(t))); items.noFaq = !withFaq.length;

  // 4) entitas & kepercayaan (E-E-A-T)
  const sameAs = pages.some(p => p.parsed.jsonld && p.parsed.jsonld.sameAs > 0), logo = pages.some(p => p.parsed.jsonld && p.parsed.jsonld.logo);
  const entityPage = allUrls.some(u => { try { return ENTITY_PATH.test(new URL(u).pathname); } catch (_) { return false; } }), contactSchema = pages.some(p => p.parsed.jsonld && p.parsed.jsonld.contact);
  const articleLike = base.filter(p => p.parsed.published || p.parsed.modified || types(p).some(t => /Article|BlogPosting|NewsArticle/.test(t)) || (p.parsed.wordCount || 0) >= 600);
  const byline = p => p.parsed.authorMeta || p.parsed.relAuthor || (p.parsed.jsonld && p.parsed.jsonld.author);
  const withAuthor = articleLike.filter(byline), rating = pages.some(p => p.parsed.jsonld && p.parsed.jsonld.rating);
  const ent = (sameAs ? 28 : 0) + (logo ? 10 : 0) + (entityPage ? 14 : 0) + (contactSchema ? 8 : 0) + (articleLike.length ? pc(withAuthor.length, articleLike.length) * 0.32 : 16) + (rating ? 8 : 0);
  put('entity', 'Entitas & kepercayaan (E-E-A-T)', 16, ent, 'Profil sosial (sameAs): ' + (sameAs ? 'ada' : 'belum') + ' · logo: ' + (logo ? 'ada' : 'belum') + ' · halaman tentang/kontak: ' + (entityPage ? 'ada' : 'tidak terlihat') + ' · penulis tercantum: ' + withAuthor.length + '/' + articleLike.length + ' artikel',
    'Cantumkan profil resmi (sameAs: LinkedIn, Instagram, dsb.) di schema Organization, siapkan halaman Tentang & Kontak, dan tampilkan nama penulis beserta profilnya di setiap artikel.');
  items.sameAs = sameAs; items.entityPage = entityPage; items.noAuthor = articleLike.filter(p => !byline(p)); items.logo = logo;

  // 5) struktur konten yang mudah dikutip AI
  const q = p => (p.parsed.h2texts || []).some(t => QUESTION.test(t));
  const ps = base.map(p => { const x = p.parsed; return { p, s: ((x.h2 || 0) >= 2 ? 30 : (x.h2 || 0) === 1 ? 12 : 0) + (q(p) ? 22 : 0) + ((x.lists || 0) + (x.tables || 0) > 0 ? 20 : 0) + ((x.wordCount || 0) >= 300 ? 16 : 6) + ((x.h1 || []).length === 1 ? 12 : 0) }; });
  const structAvg = ps.length ? ps.reduce((n, x) => n + x.s, 0) / ps.length : 0;
  put('structure', 'Struktur konten yang mudah dikutip', 20, structAvg, 'Rata-rata ' + Math.round(structAvg) + '/100 pada ' + ps.length + ' halaman konten · berjudul tanya-jawab: ' + base.filter(q).length + ' · berdaftar/tabel: ' + base.filter(p => (p.parsed.lists || 0) + (p.parsed.tables || 0) > 0).length + ' · minimal 2 subjudul (H2): ' + base.filter(p => (p.parsed.h2 || 0) >= 2).length,
    'Susun konten dengan subjudul H2 yang jelas, jawab pertanyaan langsung di paragraf pembuka (40–60 kata), tambahkan daftar/tabel ringkas dan bagian FAQ. AI lebih mudah mengutip potongan yang berdiri sendiri.');
  items.weakStruct = ps.filter(x => x.s < 60).sort((a, b) => a.s - b.s).map(x => ({ p: x.p, s: x.s })); items.noQuestion = base.filter(p => !q(p)); items.contentN = base.length;

  // 6) kesegaran
  const dated = p => p.parsed.published || p.parsed.modified || (p.parsed.jsonld && (p.parsed.jsonld.datePublished || p.parsed.jsonld.dateModified)) || p.parsed.times > 0;
  const datedN = base.filter(dated).length, lmi = lastmodInfo(sitemapEntries), lm = lmi.reliable ? sitemapEntries.filter(e => e.lastmod) : [], recent = lm.filter(e => { const d = daysAgo(e.lastmod); return d != null && d <= 365; }).length;
  put('fresh', 'Kesegaran konten', 8, pc(datedN, base.length) * 0.5 + (lm.length ? pc(recent, lm.length) * 0.5 : 0), 'Halaman bertanggal: ' + datedN + '/' + base.length + ' · sitemap lastmod ≤ 12 bulan: ' + (lm.length ? recent + '/' + lm.length : (lmi.uniform ? 'lastmod seragam (' + lmi.share + '% sama, kemungkinan otomatis) dan tidak dihitung' : 'lastmod tidak ada')),
    'Tampilkan tanggal terbit dan diperbarui (tag <time> dan dateModified di schema), isi lastmod yang akurat di sitemap, dan perbarui artikel penting secara berkala.');
  items.undated = base.filter(p => !dated(p)); items.noLastmod = !lm.length; items.lastmodUniform = lmi.uniform ? lmi : null;

  // 7) keterbacaan tanpa JavaScript
  const jsHeavy = pages.filter(p => (p.parsed.wordCount || 0) < 100 && (p.parsed.scripts || 0) > 10);
  const thin = pages.filter(p => (p.parsed.wordCount || 0) < 100);
  put('render', 'Konten terbaca tanpa JavaScript', 6, pc(pages.length - thin.length, pages.length), thin.length ? thin.length + ' dari ' + pages.length + ' halaman hampir tanpa teks di HTML awal' + (jsHeavy.length ? ' (banyak skrip, kemungkinan dirender di browser)' : '') : 'Teks halaman tersedia langsung di HTML',
    'Crawler AI umumnya tidak menjalankan JavaScript. Pastikan teks utama ada di HTML dari server (SSR/SSG), bukan baru muncul setelah skrip berjalan.');
  items.thin = thin; items.jsHeavy = jsHeavy;

  const wsum = comps.reduce((n, c) => n + c.weight, 0), score = clamp(comps.reduce((n, c) => n + c.weight * c.score, 0) / wsum);
  return { score, components: comps, pagesAssessed: pages.length, items, okBots, blockedBots: blocked.map(b => b.name) };
}

// Definisi masalah AI (format sama dengan checks.js). severity dihitung dinamis di aiIssues().
const AD = {
  ai_bots_blocked: ['AI & mesin pencari: crawler penting diblokir robots.txt', 'Crawler yang dipakai mesin AI untuk mengambil jawaban diblokir, sehingga situs tidak bisa dikutip di ChatGPT Search, Perplexity, Copilot, atau AI Overviews.', 'Hapus Disallow untuk OAI-SearchBot, PerplexityBot, Claude-SearchBot, Bingbot, dan Googlebot di robots.txt. Memblokir bot pelatihan boleh jika memang disengaja.'],
  ai_llms_missing: ['AI: llms.txt belum ada', 'llms.txt memberi ringkasan situs dan tautan penting khusus untuk model AI. Ini usulan komunitas (belum standar resmi), tetapi murah dibuat.', 'Buat /llms.txt berisi deskripsi singkat bisnis dan daftar tautan halaman terpenting (Markdown).'],
  ai_schema_org_missing: ['AI: Organization/WebSite schema belum ada di beranda', 'Mesin AI memakai schema organisasi untuk mengenali siapa Anda (entitas) dan mengaitkan halaman ke merek yang sama.', 'Tambahkan JSON-LD Organization (nama, logo, url, sameAs) dan WebSite di beranda.'],
  ai_schema_content_missing: ['AI: halaman konten tanpa schema yang sesuai', 'Halaman tanpa Article/Service/Product/LocalBusiness/FAQ lebih sulit dipahami dan dikutip sebagai sumber.', 'Tambahkan JSON-LD yang sesuai jenis halaman (Article/BlogPosting untuk artikel, Service untuk layanan, FAQPage untuk tanya-jawab) dan BreadcrumbList.'],
  ai_entity_weak: ['AI: sinyal entitas & kepercayaan (E-E-A-T) lemah', 'AI lebih percaya sumber yang jelas siapa pembuatnya: profil resmi, halaman tentang/kontak, dan penulis bernama.', 'Tambahkan sameAs (profil sosial resmi) di schema Organization, halaman Tentang & Kontak, dan byline penulis dengan profilnya di tiap artikel.'],
  ai_author_missing: ['AI: artikel tanpa nama penulis', 'Artikel tanpa penulis bernama lebih lemah sebagai sumber yang dipercaya.', 'Tampilkan nama penulis (dan tautan profil) di artikel serta cantumkan author di schema Article.'],
  ai_structure_weak: ['AI: struktur konten kurang mudah dikutip', 'Halaman tanpa subjudul jelas, daftar/tabel, atau jawaban langsung sulit diambil potongannya oleh AI.', 'Tambahkan subjudul H2 per sub-topik, jawaban ringkas di paragraf pembuka, serta daftar atau tabel ringkas.'],
  ai_no_questions: ['AI: belum ada bagian tanya-jawab / FAQ', 'Format pertanyaan-jawaban cocok dengan cara orang bertanya ke AI dan sering dikutip.', 'Tambahkan bagian FAQ berisi pertanyaan nyata pelanggan (dengan schema FAQPage) pada halaman layanan dan artikel utama.'],
  ai_fresh_missing: ['AI: halaman tanpa tanggal terbit/diperbarui', 'Tanggal membantu mesin AI menilai kesegaran informasi.', 'Tampilkan tanggal terbit dan terakhir diperbarui (<time> dan dateModified) serta isi lastmod di sitemap.'],
  ai_lastmod_uniform: ['AI: lastmod sitemap seragam (kemungkinan otomatis)', 'Hampir semua halaman di sitemap bertanggal sama, sehingga Google dan mesin AI tidak bisa membedakan halaman yang benar-benar diperbarui. Sinyal kesegaran jadi tidak berguna.', 'Isi lastmod dengan tanggal perubahan konten yang sebenarnya (bukan tanggal build/deploy), atau hilangkan lastmod bila tidak bisa akurat.'],
  ai_js_content: ['AI: teks halaman tidak terbaca tanpa JavaScript', 'Crawler AI umumnya tidak menjalankan JavaScript, jadi halaman yang teksnya baru muncul di browser tampak kosong.', 'Render konten utama di server (SSR/SSG) atau sediakan versi HTML penuh untuk crawler.'],
};
const st = (sev, id, items, extra = {}) => ({ id, severity: sev, category: 'ai', title: AD[id][0], desc: AD[id][1], fix: AD[id][2], count: items.length, truncated: items.length > 300, items: items.slice(0, 300), ...extra });
function aiIssues(a, siteUrl) {
  const out = [], it = a.items, site = d => ({ url: siteUrl, detail: d, page: false }), pg = (p, d) => ({ url: p.url, detail: d || '', page: true });
  if (it.blocked.length) out.push(st(it.retrBlocked.length ? 'error' : 'notice', 'ai_bots_blocked', [site('diblokir: ' + it.blocked.map(b => b.name).join(', '))]));
  if (a.components.find(c => c.id === 'llms').score === 0) out.push(st('notice', 'ai_llms_missing', [site('/llms.txt tidak ada')]));
  if (!it.homeOrg) out.push(st('warning', 'ai_schema_org_missing', [site('beranda tanpa Organization/WebSite JSON-LD')]));
  if (it.noContentSchema.length) out.push(st('warning', 'ai_schema_content_missing', it.noContentSchema.map(p => pg(p, 'jenis schema: ' + ((p.parsed.jsonldTypes || []).join(', ') || 'tidak ada')))));
  const ent = []; if (!it.sameAs) ent.push('belum ada sameAs (profil sosial resmi)'); if (!it.entityPage) ent.push('halaman Tentang/Kontak tidak terlihat'); if (!it.logo) ent.push('logo belum ada di schema');
  if (ent.length) out.push(st('warning', 'ai_entity_weak', ent.map(d => site(d))));
  if (it.noAuthor.length) out.push(st('notice', 'ai_author_missing', it.noAuthor.map(p => pg(p, 'tidak ada penulis'))));
  if (it.weakStruct.length) out.push(st('notice', 'ai_structure_weak', it.weakStruct.map(x => pg(x.p, 'skor struktur ' + x.s + '/100 · H2: ' + (x.p.parsed.h2 || 0) + ' · daftar/tabel: ' + ((x.p.parsed.lists || 0) + (x.p.parsed.tables || 0))))));
  if (it.contentN && it.noQuestion.length === it.contentN) out.push(st('notice', 'ai_no_questions', [site('tidak ada judul berbentuk pertanyaan di ' + it.contentN + ' halaman konten')]));
  if (it.undated.length) out.push(st('notice', 'ai_fresh_missing', it.undated.map(p => pg(p, 'tanpa tanggal'))));
  if (it.lastmodUniform) out.push(st('notice', 'ai_lastmod_uniform', [site(it.lastmodUniform.share + '% dari ' + it.lastmodUniform.n + ' URL di sitemap bertanggal sama')]));
  if (it.thin.length) out.push(st(it.jsHeavy.length ? 'warning' : 'notice', 'ai_js_content', it.thin.map(p => pg(p, (p.parsed.wordCount || 0) + ' kata di HTML awal · ' + (p.parsed.scripts || 0) + ' skrip'))));
  return out;
}
module.exports = { assess, aiIssues, BOTS, AD, lastmodInfo };
