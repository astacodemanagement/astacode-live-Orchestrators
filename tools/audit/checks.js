'use strict';
// Pengecekan audit situs: mengubah hasil crawl menjadi daftar masalah (Errors / Warnings / Notices) per kategori.
const H = require('./http');

const CATS = { crawlability: 'Crawlability & indeks', onpage: 'Konten & tag halaman', links: 'Tautan & struktur', performance: 'Kecepatan server', https: 'HTTPS & keamanan', markup: 'Data terstruktur', ai: 'AI Search & GEO', speed: 'Kecepatan (PageSpeed)' };
// [severity, category, judul, penjelasan, cara memperbaiki]
const D = {
  http_4xx: ['error', 'crawlability', 'Halaman mengembalikan error 4xx (tidak ditemukan)', 'Halaman ini ditautkan atau ada di sitemap, tetapi server membalas 4xx. Pengunjung dan Google tidak bisa membukanya.', 'Pulihkan halamannya, arahkan 301 ke halaman pengganti, atau hapus tautan yang menuju ke sana.'],
  http_5xx: ['error', 'crawlability', 'Halaman mengembalikan error server 5xx', 'Server gagal memproses permintaan. Google bisa menurunkan halaman yang sering error.', 'Periksa log aplikasi dan server pada waktu crawl, lalu perbaiki penyebabnya.'],
  fetch_error: ['error', 'crawlability', 'Halaman tidak bisa dibuka (timeout / koneksi gagal)', 'Crawler tidak menerima balasan dari server.', 'Periksa kinerja server, firewall (fail2ban/WAF), dan batas koneksi.'],
  redirect_chain: ['warning', 'crawlability', 'Rantai redirect lebih dari satu langkah', 'Beberapa redirect beruntun memperlambat halaman dan melemahkan sinyal tautan.', 'Arahkan URL awal langsung ke URL tujuan akhir dengan satu redirect 301.'],
  redirect_loop: ['error', 'crawlability', 'Redirect berputar (loop)', 'URL saling mengalihkan tanpa ujung sehingga halaman tidak pernah terbuka.', 'Perbaiki aturan redirect di server atau aplikasi.'],
  redirect_temp: ['notice', 'crawlability', 'Memakai redirect sementara (302/303/307)', 'Redirect sementara tidak memindahkan sinyal SEO secara permanen.', 'Ganti dengan 301/308 bila pemindahannya permanen.'],
  blocked_robots: ['notice', 'crawlability', 'URL ditautkan tetapi diblokir robots.txt', 'Crawler tidak boleh membuka URL ini sehingga isinya tidak ikut diaudit.', 'Pastikan memang disengaja. Jika tidak, ubah aturan Disallow di robots.txt.'],
  robots_missing: ['warning', 'crawlability', 'robots.txt tidak ditemukan', 'Tanpa robots.txt, tidak ada petunjuk untuk crawler dan lokasi sitemap.', 'Buat /robots.txt dan cantumkan baris Sitemap.'],
  robots_blocks_all: ['error', 'crawlability', 'robots.txt memblokir seluruh situs', 'Aturan "Disallow: /" untuk semua crawler menghalangi Google mengindeks situs.', 'Hapus aturan Disallow: / kecuali situs memang tidak boleh diindeks.'],
  sitemap_missing: ['warning', 'crawlability', 'Sitemap XML tidak ditemukan', 'Sitemap membantu Google menemukan seluruh halaman penting.', 'Buat sitemap.xml dan daftarkan di robots.txt serta Search Console.'],
  sitemap_invalid: ['error', 'crawlability', 'Sitemap tidak valid atau tidak bisa dibaca', 'Sitemap yang rusak diabaikan oleh mesin pencari.', 'Perbaiki format XML dan pastikan dapat dibuka dengan status 200.'],
  sitemap_bad_urls: ['error', 'crawlability', 'Sitemap berisi URL yang error (4xx/5xx)', 'Sitemap seharusnya hanya berisi URL yang berstatus 200.', 'Hapus URL error dari sitemap atau perbaiki halamannya.'],
  sitemap_redirect_urls: ['warning', 'crawlability', 'Sitemap berisi URL yang dialihkan', 'URL di sitemap sebaiknya langsung ke tujuan akhir.', 'Ganti dengan URL tujuan akhir.'],
  sitemap_noindex: ['warning', 'crawlability', 'Sitemap berisi halaman noindex', 'Halaman noindex tidak seharusnya ada di sitemap.', 'Hapus dari sitemap atau buang noindex-nya.'],
  not_in_sitemap: ['notice', 'crawlability', 'Halaman terindeks tetapi tidak ada di sitemap', 'Halaman ditemukan lewat tautan, tetapi tidak tercantum di sitemap.', 'Tambahkan halaman penting ke sitemap.'],
  orphan_page: ['warning', 'links', 'Halaman yatim (ada di sitemap, tanpa tautan masuk)', 'Tidak ada halaman lain yang menautkannya sehingga sulit ditemukan dan kurang mendapat otoritas.', 'Tautkan dari halaman terkait (menu, artikel, atau halaman layanan).'],
  noindex_pages: ['notice', 'crawlability', 'Halaman ditandai noindex', 'Halaman ini tidak akan muncul di hasil pencarian.', 'Pastikan memang disengaja.'],
  canonical_missing: ['warning', 'crawlability', 'Tag canonical tidak ada', 'Tanpa canonical, URL varian bisa dianggap duplikat.', 'Tambahkan <link rel="canonical"> yang menunjuk ke URL utama halaman.'],
  canonical_multiple: ['warning', 'crawlability', 'Lebih dari satu tag canonical', 'Google bisa mengabaikan canonical bila ada beberapa yang bertentangan.', 'Sisakan satu tag canonical.'],
  canonical_broken: ['error', 'crawlability', 'Canonical mengarah ke halaman error atau redirect', 'Canonical harus menunjuk ke URL yang berstatus 200.', 'Arahkan canonical ke URL final yang valid.'],
  canonical_other: ['notice', 'crawlability', 'Canonical mengarah ke URL lain', 'Halaman ini menyatakan URL lain sebagai versi utamanya, sehingga tidak akan diindeks sendiri.', 'Pastikan memang disengaja.'],
  https_missing: ['error', 'https', 'Situs tidak memakai HTTPS', 'Data pengunjung tidak terenkripsi dan browser menandai situs "tidak aman".', 'Pasang sertifikat SSL dan alihkan semua trafik ke HTTPS.'],
  https_no_redirect: ['error', 'https', 'Versi HTTP tidak dialihkan ke HTTPS', 'Situs bisa dibuka lewat HTTP biasa sehingga ada dua versi.', 'Tambahkan redirect 301 dari http:// ke https://.'],
  hsts_missing: ['notice', 'https', 'Header HSTS tidak ada', 'HSTS memaksa browser memakai HTTPS.', 'Tambahkan header Strict-Transport-Security.'],
  mixed_content: ['error', 'https', 'Konten campuran (sumber HTTP di halaman HTTPS)', 'Browser dapat memblokir gambar, skrip, atau CSS yang dimuat lewat HTTP.', 'Ubah semua sumber menjadi https://.'],
  security_headers: ['notice', 'https', 'Header keamanan dasar belum lengkap', 'Header ini melindungi pengunjung dari serangan umum (clickjacking, sniffing).', 'Tambahkan X-Content-Type-Options, Referrer-Policy, dan CSP atau X-Frame-Options.'],
  server_leak: ['notice', 'https', 'Server menampilkan versi perangkat lunak', 'Versi yang terlihat memudahkan penyerang mencari celah.', 'Sembunyikan versi di header Server / X-Powered-By.'],
  host_variant: ['warning', 'crawlability', 'Versi www / non-www tidak dialihkan', 'Dua alamat menyajikan situs yang sama sehingga terbaca sebagai konten ganda.', 'Alihkan salah satu versi ke versi utama dengan 301.'],
  soft_404_site: ['warning', 'crawlability', 'URL yang tidak ada mengembalikan status 200 (soft 404)', 'Halaman "tidak ditemukan" seharusnya berstatus 404.', 'Pastikan halaman error mengirim status 404.'],
  title_missing: ['error', 'onpage', 'Judul halaman (title) tidak ada', 'Judul adalah sinyal on-page terpenting dan tampil di hasil pencarian.', 'Tambahkan <title> yang unik dan deskriptif.'],
  title_short: ['notice', 'onpage', 'Judul terlalu pendek (< 30 karakter)', 'Judul yang terlalu singkat kurang memanfaatkan ruang di hasil pencarian.', 'Perluas dengan kata kunci dan manfaat utama.'],
  title_long: ['warning', 'onpage', 'Judul terlalu panjang (> 60 karakter)', 'Judul panjang akan terpotong di hasil pencarian.', 'Ringkas hingga sekitar 50–60 karakter.'],
  title_duplicate: ['warning', 'onpage', 'Judul duplikat di beberapa halaman', 'Judul yang sama membuat halaman sulit dibedakan oleh Google.', 'Buat judul unik untuk setiap halaman.'],
  meta_missing: ['warning', 'onpage', 'Meta description tidak ada', 'Meta description memengaruhi seberapa menarik hasil pencarian diklik.', 'Tulis deskripsi unik 70–160 karakter.'],
  meta_short: ['notice', 'onpage', 'Meta description terlalu pendek (< 70 karakter)', 'Deskripsi pendek kurang menjelaskan isi halaman.', 'Perluas hingga 120–160 karakter.'],
  meta_long: ['notice', 'onpage', 'Meta description terlalu panjang (> 160 karakter)', 'Bagian akhirnya akan terpotong.', 'Ringkas hingga maksimal 160 karakter.'],
  meta_duplicate: ['warning', 'onpage', 'Meta description duplikat', 'Deskripsi yang sama di banyak halaman mengurangi daya tarik hasil pencarian.', 'Tulis deskripsi unik per halaman.'],
  h1_missing: ['warning', 'onpage', 'Heading H1 tidak ada', 'H1 menjelaskan topik utama halaman.', 'Tambahkan satu H1 yang relevan.'],
  h1_multiple: ['notice', 'onpage', 'Lebih dari satu H1', 'Satu H1 per halaman lebih jelas bagi pembaca dan mesin pencari.', 'Sisakan satu H1, ubah sisanya menjadi H2.'],
  thin_content: ['notice', 'onpage', 'Konten sangat sedikit (< 200 kata)', 'Halaman tipis sulit bersaing dan bisa dianggap kurang bernilai.', 'Tambahkan konten yang menjawab kebutuhan pencari.'],
  img_alt_missing: ['warning', 'onpage', 'Gambar tanpa atribut alt', 'Teks alt membantu aksesibilitas dan pencarian gambar.', 'Tambahkan alt yang menjelaskan gambar (alt kosong hanya untuk gambar dekoratif).'],
  lang_missing: ['notice', 'onpage', 'Atribut bahasa (lang) tidak ada', 'Atribut lang membantu mesin pencari dan pembaca layar.', 'Tambahkan <html lang="id">.'],
  viewport_missing: ['warning', 'onpage', 'Meta viewport tidak ada', 'Tanpa viewport halaman tidak ramah perangkat seluler.', 'Tambahkan <meta name="viewport" content="width=device-width, initial-scale=1">.'],
  og_missing: ['notice', 'onpage', 'Tag Open Graph (og:title / og:image) tidak lengkap', 'Pratinjau saat dibagikan di media sosial kurang menarik.', 'Tambahkan og:title, og:description, dan og:image.'],
  schema_invalid: ['error', 'markup', 'Data terstruktur (JSON-LD) tidak valid', 'JSON-LD yang rusak diabaikan Google sehingga rich result tidak muncul.', 'Perbaiki sintaks JSON-LD dan uji dengan Rich Results Test.'],
  schema_none: ['notice', 'markup', 'Belum ada data terstruktur (schema.org)', 'Schema membantu Google dan mesin AI memahami bisnis dan halaman Anda.', 'Tambahkan Organization, WebSite, dan Article/Service sesuai halaman.'],
  slow_response: ['warning', 'performance', 'Respons server lambat (0,8–2,5 detik)', 'Waktu respons awal yang lambat menurunkan kecepatan seluruh halaman.', 'Aktifkan cache, optimalkan query dan konfigurasi server.'],
  very_slow_response: ['error', 'performance', 'Respons server sangat lambat (> 2,5 detik)', 'Halaman sangat lambat membuat pengunjung pergi dan membebani crawl.', 'Cari bottleneck: query database, cache, atau sumber daya server.'],
  no_compression: ['warning', 'performance', 'HTML tidak dikompresi (gzip/brotli)', 'Kompresi memperkecil ukuran halaman 60–80%.', 'Aktifkan gzip atau brotli di web server.'],
  large_html: ['notice', 'performance', 'Ukuran HTML besar (> 500 KB)', 'HTML besar memperlambat parsing terutama di ponsel.', 'Kurangi markup, tunda konten yang tidak penting.'],
  broken_internal_links: ['error', 'links', 'Halaman memuat tautan internal rusak', 'Tautan ke halaman yang error merusak pengalaman dan menyia-nyiakan crawl.', 'Perbarui atau hapus tautan rusak.'],
  broken_external_links: ['warning', 'links', 'Tautan eksternal rusak', 'Tautan keluar yang mati menurunkan kualitas halaman.', 'Ganti dengan sumber yang masih aktif atau hapus.'],
  broken_assets: ['warning', 'links', 'Gambar / file (CSS, JS, PDF) tidak ditemukan', 'Aset yang hilang merusak tampilan halaman.', 'Unggah ulang aset atau perbarui alamatnya.'],
  link_to_redirect: ['notice', 'links', 'Tautan internal menuju URL yang dialihkan', 'Setiap tautan harus langsung ke URL final agar hemat waktu muat.', 'Perbarui tautan ke URL tujuan akhir.'],
  deep_page: ['notice', 'links', 'Halaman terlalu dalam (> 3 klik dari beranda)', 'Halaman yang jauh dari beranda lebih jarang di-crawl dan kurang otoritas.', 'Tambahkan tautan dari halaman yang lebih dekat dengan beranda.'],
  few_inlinks: ['notice', 'links', 'Halaman hanya punya satu tautan masuk', 'Sedikit tautan internal berarti sinyal kepentingan yang lemah.', 'Tambahkan tautan internal dari artikel dan halaman layanan terkait.'],
  url_format: ['notice', 'links', 'Format URL kurang ideal', 'URL panjang, bergaris bawah, atau berhuruf besar lebih sulit dibaca dan dibagikan.', 'Gunakan URL pendek, huruf kecil, dan tanda hubung.'],
};
const meta = id => ({ severity: D[id][0], category: D[id][1], title: D[id][2], desc: D[id][3], fix: D[id][4] });
const short = (u, n = 70) => { try { const x = new URL(u); const s = x.pathname + x.search; return s.length > n ? s.slice(0, n - 1) + '…' : (s === '/' ? '/' : s); } catch (_) { return u; } };
const refs = (p, k = 3) => { const a = (p.inlinks || []).slice(0, k).map(u => short(u)); return a.length ? 'ditautkan dari ' + a.join(', ') + (p.inlinkCount > k ? ' (+' + (p.inlinkCount - k) + ')' : '') : (p.inSitemap ? 'ada di sitemap' : ''); };
const hasChain = p => p.chain && p.chain.length > 0;

function runChecks(model, cfg = {}) {
  const P = model.pages, home = H.norm(model.site, model.origin), byUrl = new Map(P.map(p => [p.url, p]));
  const htmlPages = P.filter(p => p.parsed && p.finalStatus === 200);
  const noindex = p => /noindex/.test(p.parsed.robots || '') || /noindex/i.test((p.headers && p.headers['x-robots-tag']) || '');
  const idx = htmlPages.filter(p => !noindex(p));
  const issues = [], pg = (p, detail) => ({ url: p.url, detail: detail || '', page: true });
  const site = detail => ({ url: model.site, detail: detail || '', page: false });
  const add = (id, items, extra = {}) => { if (!items.length) return; issues.push({ id, ...meta(id), count: items.length, truncated: items.length > 300, items: items.slice(0, 300), ...extra }); };

  // ---- status & redirect
  const live = P.filter(p => !p.blocked && p.status !== null);
  const plain = live.filter(p => !hasChain(p));
  add('http_4xx', plain.filter(p => p.status >= 400 && p.status < 500).map(p => pg(p, 'HTTP ' + p.status + (refs(p) ? ' · ' + refs(p) : ''))));
  add('http_5xx', plain.filter(p => p.status >= 500).map(p => pg(p, 'HTTP ' + p.status + (refs(p) ? ' · ' + refs(p) : ''))));
  add('fetch_error', plain.filter(p => p.status === 0).map(p => pg(p, p.error || 'tidak ada balasan')));
  add('redirect_chain', live.filter(p => p.chain && p.chain.length >= 2 && !p.loop).map(p => pg(p, [...p.chain.map(c => c.status + ' ' + short(c.url, 40)), short(p.finalUrl, 40)].join(' → '))));
  add('redirect_loop', live.filter(p => p.loop).map(p => pg(p, 'loop: ' + p.chain.map(c => short(c.url, 40)).join(' → '))));
  add('redirect_temp', live.filter(p => p.chain && p.chain.some(c => [302, 303, 307].includes(c.status))).map(p => pg(p, p.chain.map(c => c.status + ' → ' + short(c.to, 50)).join(', '))));
  add('blocked_robots', P.filter(p => p.blocked).map(p => pg(p, refs(p))));

  // tautan internal bermasalah, dikelompokkan per halaman sumber
  const bySrc = (pred, fmt) => { const m = new Map(); for (const t of P) if (pred(t)) for (const s of t.inlinks || []) { const a = m.get(s) || m.set(s, []).get(s); a.push(fmt(t)); }
    return [...m.entries()].map(([s, a]) => ({ url: s, detail: a.slice(0, 3).join(', ') + (a.length > 3 ? ' (+' + (a.length - 3) + ')' : ''), page: true })); };
  add('broken_internal_links', bySrc(t => !t.blocked && !hasChain(t) && t.status !== null && (t.status >= 400 || t.status === 0), t => short(t.url, 45) + ' [' + (t.status || 'gagal') + ']'));
  add('link_to_redirect', bySrc(t => !t.blocked && hasChain(t) && !t.loop, t => short(t.url, 40) + ' [' + t.chain[0].status + ' → ' + short(t.redirectTo, 40) + ']'));
  add('broken_external_links', (model.externals || []).filter(e => (e.status >= 400 && ![401, 403, 429, 999].includes(e.status)) || (e.status === 0 && /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ECONNRESET|CERT/i.test(e.error || '')))
    .map(e => ({ url: e.url, detail: (e.status ? 'HTTP ' + e.status : e.error) + ' · ditautkan dari ' + e.sources.map(s => short(s, 40)).join(', '), page: false })));
  add('broken_assets', (model.assets || []).filter(a => a.status >= 400 || (a.status === 0 && /ENOTFOUND|ECONNREFUSED/i.test(a.error || ''))).map(a => ({ url: a.url, detail: 'HTTP ' + (a.status || a.error) + ' · dipakai di ' + a.sources.map(s => short(s, 40)).join(', '), page: false })));

  // ---- robots & sitemap
  if ([404, 410].includes(model.robots.status)) add('robots_missing', [site('/robots.txt tidak ada (' + model.robots.status + ')')]);
  if (model.robots.blocksAll) add('robots_blocks_all', [site('User-agent: * Disallow: /')]);
  const sm = model.sitemap;
  if (sm && !sm.found && !sm.errors.some(e => /tidak valid/.test(e.error))) add('sitemap_missing', [site(sm.errors[0] ? sm.errors[0].error : 'tidak ada sitemap')]);
  if (sm && sm.errors.some(e => /tidak valid|terkompresi/.test(e.error))) add('sitemap_invalid', sm.errors.filter(e => /tidak valid|terkompresi/.test(e.error)).map(e => ({ url: e.url, detail: e.error, page: false })));
  const inSm = P.filter(p => p.inSitemap && !p.blocked && p.status !== null);
  add('sitemap_bad_urls', inSm.filter(p => !hasChain(p) && (p.status >= 400 || p.status === 0)).map(p => pg(p, 'HTTP ' + (p.status || p.error))));
  add('sitemap_redirect_urls', inSm.filter(p => hasChain(p)).map(p => pg(p, p.chain[0].status + ' → ' + short(p.redirectTo, 50))));
  add('sitemap_noindex', inSm.filter(p => p.parsed && noindex(p)).map(p => pg(p, 'noindex')));
  if (sm && sm.found) add('not_in_sitemap', idx.filter(p => !p.inSitemap && !model.sitemapSet.has(p.url) && !p.viaRedirect).map(p => pg(p, refs(p))));
  add('orphan_page', idx.filter(p => p.inSitemap && p.inlinkCount === 0 && p.url !== home).map(p => pg(p, 'hanya ada di sitemap')));
  add('noindex_pages', htmlPages.filter(noindex).map(p => pg(p, p.parsed.robots || 'X-Robots-Tag')));

  // ---- canonical
  add('canonical_missing', idx.filter(p => p.parsed.canonical === null).map(p => pg(p)));
  add('canonical_multiple', idx.filter(p => p.parsed.canonicalCount > 1).map(p => pg(p, p.parsed.canonicalCount + ' tag canonical')));
  const same = (a, b) => a === b || a.replace(/\/$/, '') === b.replace(/\/$/, '');
  const cBroken = [], cOther = [];
  for (const p of idx) { if (!p.parsed.canonical) continue; const c = H.norm(p.parsed.canonical, p.url); if (!c || same(c, p.url)) continue;
    const t = byUrl.get(c); if (t && (hasChain(t) || t.status >= 400)) cBroken.push(pg(p, 'canonical → ' + short(c, 60) + ' [' + (hasChain(t) ? 'redirect ' + t.chain[0].status : t.status) + ']')); else cOther.push(pg(p, 'canonical → ' + (c.startsWith(model.origin) ? short(c, 60) : c))); }
  add('canonical_broken', cBroken); add('canonical_other', cOther);

  // ---- HTTPS, host, soft 404
  const hc = model.hostChecks || {};
  if (hc.httpsMissing) add('https_missing', [site('alamat situs memakai http://')]);
  if (hc.httpToHttps && !hc.httpToHttps.error) { const h = hc.httpToHttps, to = h.location || '';
    if (h.status === 200) add('https_no_redirect', [site('http:// membalas 200 tanpa redirect')]);
    else if ([301, 302, 303, 307, 308].includes(h.status) && !/^https:/i.test(to) && !/^\//.test(to)) add('https_no_redirect', [site('http:// dialihkan ke ' + to)]); }
  if (hc.hostVariant && hc.hostVariant.status === 200) add('host_variant', [site(hc.hostVariant.host + ' membalas 200 tanpa redirect')]);
  if (hc.soft404 && hc.soft404.status === 200) add('soft_404_site', [site('URL acak yang tidak ada membalas 200')]);
  const hp = byUrl.get(home) || P.find(p => p.parsed && p.headers);
  if (hp && hp.headers) {
    const hd = hp.headers, httpsSite = model.site.startsWith('https:');
    if (httpsSite && !hd['strict-transport-security']) add('hsts_missing', [site('header Strict-Transport-Security tidak ada')]);
    const miss = []; if (!hd['x-content-type-options']) miss.push('X-Content-Type-Options'); if (!hd['referrer-policy']) miss.push('Referrer-Policy'); if (!hd['content-security-policy'] && !hd['x-frame-options']) miss.push('CSP atau X-Frame-Options');
    if (miss.length) add('security_headers', [site('belum ada: ' + miss.join(', '))]);
    const leak = []; if (/\d+\.\d+/.test(hd.server || '')) leak.push('Server: ' + hd.server); if (hd['x-powered-by']) leak.push('X-Powered-By: ' + hd['x-powered-by']);
    if (leak.length) add('server_leak', [site(leak.join(' · '))]);
  }
  add('mixed_content', idx.filter(p => p.url.startsWith('https:') && p.parsed.mixedCount > 0).map(p => pg(p, p.parsed.mixedCount + ' sumber HTTP, mis. ' + p.parsed.mixed[0])));

  // ---- on-page
  const T = p => (p.parsed.title || '').trim(), M = p => (p.parsed.metaDescription || '').trim();
  add('title_missing', idx.filter(p => !T(p)).map(p => pg(p)));
  add('title_short', idx.filter(p => T(p) && T(p).length < 30).map(p => pg(p, T(p).length + ' karakter: ' + T(p))));
  add('title_long', idx.filter(p => T(p).length > 60).map(p => pg(p, T(p).length + ' karakter')));
  const dupes = (get, minLen) => { const g = new Map(); for (const p of idx) { const v = get(p).toLowerCase(); if (v.length >= minLen) (g.get(v) || g.set(v, []).get(v)).push(p); }
    return [...g.values()].filter(a => a.length > 1).flatMap(a => a.map(p => pg(p, 'sama dengan ' + (a.length - 1) + ' halaman lain, mis. ' + short(a.find(x => x !== p).url, 45)))); };
  add('title_duplicate', dupes(T, 1));
  add('meta_missing', idx.filter(p => !M(p)).map(p => pg(p)));
  add('meta_short', idx.filter(p => M(p) && M(p).length < 70).map(p => pg(p, M(p).length + ' karakter')));
  add('meta_long', idx.filter(p => M(p).length > 160).map(p => pg(p, M(p).length + ' karakter')));
  add('meta_duplicate', dupes(M, 1));
  add('h1_missing', idx.filter(p => p.parsed.h1.filter(Boolean).length === 0).map(p => pg(p)));
  add('h1_multiple', idx.filter(p => p.parsed.h1.length > 1).map(p => pg(p, p.parsed.h1.length + ' H1')));
  add('thin_content', idx.filter(p => p.parsed.wordCount < 200).map(p => pg(p, p.parsed.wordCount + ' kata')));
  add('img_alt_missing', idx.filter(p => p.parsed.imagesNoAlt > 0).map(p => pg(p, p.parsed.imagesNoAlt + ' dari ' + p.parsed.images + ' gambar tanpa alt')));
  add('lang_missing', idx.filter(p => !p.parsed.lang).map(p => pg(p)));
  add('viewport_missing', idx.filter(p => !p.parsed.viewport).map(p => pg(p)));
  add('og_missing', idx.filter(p => !p.parsed.ogTitle || !p.parsed.ogImage).map(p => pg(p, [!p.parsed.ogTitle && 'og:title', !p.parsed.ogImage && 'og:image'].filter(Boolean).join(', ') + ' belum ada')));
  add('schema_invalid', idx.filter(p => p.parsed.jsonldErrors > 0).map(p => pg(p, p.parsed.jsonldErrors + ' blok JSON-LD rusak')));
  if (idx.length && !idx.some(p => p.parsed.jsonldBlocks > 0)) add('schema_none', [site('tidak ada JSON-LD di ' + idx.length + ' halaman yang diperiksa')]);

  // ---- performa server
  const timed = htmlPages.filter(p => p.ttfb != null);
  add('slow_response', timed.filter(p => p.ttfb > 800 && p.ttfb <= 2500).map(p => pg(p, p.ttfb + ' ms')));
  add('very_slow_response', timed.filter(p => p.ttfb > 2500).map(p => pg(p, p.ttfb + ' ms')));
  add('no_compression', htmlPages.filter(p => p.bytes > 1500 && !/gzip|br|deflate|zstd/.test((p.headers && p.headers['content-encoding']) || '')).map(p => pg(p, Math.round(p.bytes / 1024) + ' KB tanpa kompresi')));
  add('large_html', htmlPages.filter(p => p.bytes > 500000).map(p => pg(p, Math.round(p.bytes / 1024) + ' KB')));

  // ---- struktur: kedalaman klik dari beranda, tautan masuk, format URL
  const dist = new Map(); if (byUrl.has(home)) { dist.set(home, 0); const q = [home];
    while (q.length) { const u = q.shift(), p = byUrl.get(u); if (!p) continue; const d = dist.get(u);
      const outs = [...(p.outlinks || [])]; if (p.chain && p.chain[0] && p.finalUrl) outs.push(p.finalUrl);
      for (let o of outs) { const t = byUrl.get(o); if (t && hasChain(t) && t.finalUrl) o = t.finalUrl; if (!dist.has(o) && byUrl.has(o)) { dist.set(o, d + 1); q.push(o); } } } }
  add('deep_page', idx.filter(p => (dist.get(p.url) || 0) > 3).map(p => pg(p, dist.get(p.url) + ' klik dari beranda')));
  add('few_inlinks', idx.filter(p => p.url !== home && p.inlinkCount === 1).map(p => pg(p, 'hanya dari ' + short(p.inlinks[0], 50))));
  add('url_format', idx.filter(p => { try { const x = new URL(p.url); return p.url.length > 115 || /[A-Z]/.test(x.pathname) || x.pathname.includes('_'); } catch (_) { return false; } })
    .map(p => { const x = new URL(p.url), r = []; if (p.url.length > 115) r.push('panjang ' + p.url.length); if (/[A-Z]/.test(x.pathname)) r.push('huruf besar'); if (x.pathname.includes('_')) r.push('garis bawah'); return pg(p, r.join(', ')); }));

  // ---- ringkasan per halaman
  const per = new Map();
  for (const is of issues) for (const it of is.items) if (it.page) { const c = per.get(it.url) || per.set(it.url, { e: 0, w: 0, n: 0 }).get(it.url); c[is.severity === 'error' ? 'e' : is.severity === 'warning' ? 'w' : 'n']++; }
  const pages = P.filter(p => !p.blocked && p.status !== null && (!hasChain(p) || p.parsed)).map(p => ({
    url: p.url, status: hasChain(p) ? p.status : (p.status || 0), words: p.parsed ? p.parsed.wordCount : null, title: p.parsed ? p.parsed.title : null, ttfb: p.ttfb,
    depth: dist.has(p.url) ? dist.get(p.url) : null, inlinks: p.inlinkCount, issues: per.get(p.url) || { e: 0, w: 0, n: 0 } }));
  // laporan menyimpan paling banyak 1.000 halaman: yang bermasalah paling banyak didahulukan
  pages.sort((x, y) => (y.issues.e - x.issues.e) || (y.issues.w - x.issues.w) || (y.issues.n - x.issues.n)); pages.length = Math.min(pages.length, 1000);
  issues.sort((a, b) => ({ error: 0, warning: 1, notice: 2 }[a.severity] - { error: 0, warning: 1, notice: 2 }[b.severity]) || b.count - a.count);
  return { issues, pages, htmlCount: htmlPages.length, indexable: idx.length };
}
module.exports = { runChecks, CATS, DEFS: D };
