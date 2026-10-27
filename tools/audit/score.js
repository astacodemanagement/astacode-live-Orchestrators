'use strict';
// Skor kesehatan situs (0–100). Rumus sengaja sederhana dan transparan (berbeda dari rumus internal Semrush):
//  - tiap halaman mendapat penalti: error 0,25 · warning 0,08 · notice 0,01 per masalah, maksimal 1 per halaman
//  - skor = 100 × (1 − rata-rata penalti halaman) − pengurang masalah tingkat situs (error 3 · warning 1 · notice 0,2; maksimal 25)
const W = { error: 0.25, warning: 0.08, notice: 0.01 }, S = { error: 3, warning: 1, notice: 0.2 };
function calc(list, totalPages) {
  const pen = new Map(); let site = 0;
  for (const i of list) { const k = i.items.length ? i.count / i.items.length : 1;
    for (const it of i.items) { if (it.page) pen.set(it.url, (pen.get(it.url) || 0) + W[i.severity] * k); else site += S[i.severity]; } }
  let sum = 0; pen.forEach(v => { sum += Math.min(1, v); });
  const mean = totalPages ? sum / totalPages : 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - mean) - Math.min(25, site))));
}
// Kategori di luar skor kesehatan (dinilai terpisah): AI Search dan kecepatan PageSpeed. Skor SEO = campuran berbobot kategori inti SEO.
const OUTSIDE = new Set(['ai', 'speed']), SEO_W = { crawlability: 30, onpage: 35, links: 20, markup: 15 };
function computeScore(issues, totalPages, cats) {
  const out = { score: calc(issues.filter(i => !OUTSIDE.has(i.category)), totalPages), categories: {} };
  for (const [id, label] of Object.entries(cats)) {
    const list = issues.filter(i => i.category === id);
    out.categories[id] = { label, score: calc(list, totalPages), errors: list.filter(i => i.severity === 'error').length, warnings: list.filter(i => i.severity === 'warning').length, notices: list.filter(i => i.severity === 'notice').length };
  }
  let w = 0, v = 0; for (const [k, wt] of Object.entries(SEO_W)) if (out.categories[k]) { w += wt; v += wt * out.categories[k].score; }
  out.seo = w ? Math.round(v / w) : out.score;
  return out;
}
module.exports = { computeScore };
