'use strict';
// Core Web Vitals lewat PageSpeed Insights API (butuh PSI_API_KEY). Data lab (Lighthouse) selalu ada; data lapangan (CrUX) hanya bila trafik cukup.
const { sleep } = require('./http');
const BASE = () => process.env.PSI_BASE || 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const LIM = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], tbt: [200, 600], fcp: [1800, 3000] };
const rate = (k, v) => v == null ? null : v <= LIM[k][0] ? 'good' : v <= LIM[k][1] ? 'ni' : 'poor';
function parsePsi(j) {
  const a = (j.lighthouseResult && j.lighthouseResult.audits) || {}, num = id => (a[id] && a[id].numericValue != null ? a[id].numericValue : null);
  const fld = m => { m = m || {}; const g = k => (m[k] && m[k].percentile != null ? m[k].percentile : null);
    const cls = m.CUMULATIVE_LAYOUT_SHIFT_SCORE && m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile != null ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null;
    return { lcp: g('LARGEST_CONTENTFUL_PAINT_MS'), inp: g('INTERACTION_TO_NEXT_PAINT'), cls, fcp: g('FIRST_CONTENTFUL_PAINT_MS') }; };
  const field = fld(j.loadingExperience && j.loadingExperience.metrics), origin = fld(j.originLoadingExperience && j.originLoadingExperience.metrics);
  const lab = { lcp: num('largest-contentful-paint'), cls: num('cumulative-layout-shift'), tbt: num('total-blocking-time'), fcp: num('first-contentful-paint'), si: num('speed-index') };
  const opp = Object.values(a).filter(x => x && x.details && x.details.overallSavingsMs > 300).sort((x, y) => y.details.overallSavingsMs - x.details.overallSavingsMs).slice(0, 4).map(x => ({ title: x.title, ms: Math.round(x.details.overallSavingsMs) }));
  const sc = j.lighthouseResult && j.lighthouseResult.categories && j.lighthouseResult.categories.performance && j.lighthouseResult.categories.performance.score;
  const hasField = Object.values(field).some(v => v != null), hasOrigin = Object.values(origin).some(v => v != null);
  return { perf: sc == null ? null : Math.round(sc * 100), lab, field: hasField ? field : null, origin: hasOrigin ? origin : null, opportunities: opp,
    ratings: { lcp: rate('lcp', (hasField ? field.lcp : null) ?? lab.lcp), inp: rate('inp', hasField ? field.inp : null), cls: rate('cls', (hasField ? field.cls : null) ?? lab.cls), tbt: rate('tbt', lab.tbt) },
    source: { lcp: hasField && field.lcp != null ? 'lapangan' : 'lab', cls: hasField && field.cls != null ? 'lapangan' : 'lab' } };
}
async function runVitals(urls, { key, strategies = ['mobile'], log = () => {}, onItem = () => {} }) {
  const out = [];
  if (!key) return { skipped: 'PSI_API_KEY belum diisi', items: out };
  for (const url of urls) for (const strategy of strategies) {
    const q = new URLSearchParams({ url, strategy, category: 'performance', locale: 'id', key });
    let item = { url, strategy, ok: false };
    for (let attempt = 0; attempt < 2 && !item.ok; attempt++) {
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 100000);
        const r = await fetch(BASE() + '?' + q, { signal: ctl.signal }); clearTimeout(to);
        if (r.status === 429 || r.status >= 500) { item.error = 'HTTP ' + r.status; await sleep(4000); continue; }
        const j = await r.json();
        if (!r.ok) { item.error = (j.error && j.error.message) ? String(j.error.message).slice(0, 160) : 'HTTP ' + r.status; break; }
        item = { url, strategy, ok: true, fetchedAt: new Date().toISOString(), ...parsePsi(j) };
      } catch (e) { item.error = e.name === 'AbortError' ? 'timeout' : e.message; }
    }
    log('vitals ' + strategy + ' ' + url + ': ' + (item.ok ? 'skor ' + item.perf : item.error)); out.push(item); onItem(out.length, urls.length * strategies.length); await sleep(1500);
  }
  return { items: out };
}

// Skor kecepatan per perangkat: rata-rata skor Lighthouse halaman yang berhasil diukur, plus skor beranda.
function speedScores(v, homeUrl) {
  const out = {}; if (!v || !v.items) return out;
  for (const strat of ['mobile', 'desktop']) {
    const ok = v.items.filter(i => i.ok && i.strategy === strat && i.perf != null); if (!ok.length) continue;
    const home = ok.find(i => i.url === homeUrl) || ok[0];
    out[strat] = { score: Math.round(ok.reduce((n, i) => n + i.perf, 0) / ok.length), home: home.perf, pages: ok.length, worst: ok.reduce((m, i) => i.perf < m.perf ? i : m, ok[0]).perf,
      lcp: home.lab && home.lab.lcp != null ? Math.round(home.lab.lcp) : null, cls: home.lab && home.lab.cls != null ? +home.lab.cls.toFixed(3) : null, tbt: home.lab && home.lab.tbt != null ? Math.round(home.lab.tbt) : null };
  }
  return out;
}
// Masalah kecepatan dari hasil PageSpeed (kategori 'speed'; tidak memengaruhi skor kesehatan, dinilai di skor kecepatan).
const SD = {
  speed_mobile_low: ['Kecepatan mobile rendah (skor PageSpeed < 90)', 'Mayoritas pengunjung memakai ponsel; skor rendah berarti halaman lambat dimuat dan berisiko turun peringkat serta konversi.', 'Kecilkan dan kompres gambar (WebP/AVIF, ukuran sesuai layar), tunda JavaScript yang tidak perlu, aktifkan cache dan CDN, dan hilangkan CSS/JS yang tidak terpakai.'],
  speed_desktop_low: ['Kecepatan desktop rendah (skor PageSpeed < 90)', 'Halaman lambat di desktop menandakan masalah mendasar pada server, aset, atau skrip.', 'Periksa waktu respons server, ukuran aset, dan skrip pihak ketiga yang memblokir render.'],
  cwv_poor: ['Core Web Vitals buruk (LCP / CLS / INP / TBT)', 'Core Web Vitals adalah sinyal pengalaman halaman yang dipakai Google. Nilai buruk merugikan peringkat dan kenyamanan pengunjung.', 'LCP: optimalkan gambar/hero dan server. CLS: beri ukuran tetap pada gambar, iklan, dan font. INP/TBT: kurangi JavaScript berat di main thread.'],
  speed_opportunities: ['Peluang percepatan dari Lighthouse', 'Lighthouse menemukan pekerjaan teknis yang menghemat waktu muat secara terukur.', 'Kerjakan dari penghematan terbesar: biasanya gambar, JavaScript/CSS tak terpakai, render-blocking, dan cache.'],
};
const secs = ms => ms == null ? '–' : (ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' dtk';
function vitalsIssues(v) {
  const out = []; if (!v || !v.items) return out; const ok = v.items.filter(i => i.ok), mk = (id, sev, items) => items.length && out.push({ id, severity: sev, category: 'speed', title: SD[id][0], desc: SD[id][1], fix: SD[id][2], count: items.length, truncated: false, items: items.slice(0, 300) });
  for (const strat of ['mobile', 'desktop']) {
    const low = ok.filter(i => i.strategy === strat && i.perf != null && i.perf < 90).sort((a, b) => a.perf - b.perf);
    mk('speed_' + strat + '_low', low.some(i => i.perf < 50) ? 'error' : 'warning', low.map(i => ({ url: i.url, page: false, detail: 'skor ' + i.perf + ' · LCP ' + secs(i.lab && i.lab.lcp) + ' · TBT ' + (i.lab && i.lab.tbt != null ? Math.round(i.lab.tbt) + ' ms' : '–') })));
  }
  const poor = ok.filter(i => i.ratings && Object.values(i.ratings).includes('poor'));
  mk('cwv_poor', 'error', poor.map(i => ({ url: i.url, page: false, detail: (i.strategy === 'mobile' ? 'mobile' : 'desktop') + ' · ' + Object.entries(i.ratings).filter(([, r]) => r === 'poor').map(([k]) => k.toUpperCase()).join(', ') + ' buruk' })));
  const agg = new Map(); for (const i of ok) for (const o of i.opportunities || []) { const a = agg.get(o.title) || agg.set(o.title, { ms: 0, n: 0 }).get(o.title); a.ms += o.ms; a.n++; }
  mk('speed_opportunities', 'warning', [...agg.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8).map(([t, a]) => ({ url: t, page: false, detail: 'hemat ±' + secs(Math.round(a.ms / a.n)) + ' per halaman · ' + a.n + ' halaman' })));
  return out;
}
module.exports = { runVitals, parsePsi, rate, LIM, speedScores, vitalsIssues };
