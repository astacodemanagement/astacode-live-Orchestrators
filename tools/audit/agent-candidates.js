'use strict';
// Kandidat kompetitor dari agent Hermes (mis. agent SEO). Agent menentukan sendiri layanan, keyword, dan pesaing lewat skill riset miliknya;
// di sini jawabannya (JSON) hanya diurai dan divalidasi ketat, lalu disimpan sebagai SARAN yang Anda setujui (Pantau / Abaikan).
const fs = require('fs'), path = require('path');
// Situs yang hampir selalu muncul tetapi bukan pesaing jasa/produk (media sosial, marketplace, ensiklopedia, portal berita, forum, instansi).
const BLOCK = /(^|\.)(google\.[a-z.]+|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.[a-z.]+|reddit\.com|quora\.com|medium\.com|wikipedia\.org|wikihow\.com|tokopedia\.com|shopee\.[a-z.]+|bukalapak\.com|lazada\.[a-z.]+|olx\.[a-z.]+|blibli\.com|amazon\.[a-z.]+|ebay\.[a-z.]+|detik\.com|kompas\.com|cnnindonesia\.com|kumparan\.com|liputan6\.com|tribunnews\.com|idntimes\.com|brainly\.[a-z.]+|scribd\.com|github\.com|stackoverflow\.com|apple\.com|microsoft\.com|wordpress\.com|blogspot\.com|wixsite\.com|canva\.com|bing\.com|yahoo\.com|duckduckgo\.com|t\.me|whatsapp\.com|clutch\.co|goodfirms\.co|designrush\.com|sortlist\.com|gov\.[a-z]+|go\.id|ac\.id|sch\.id)$/i;
const DOMAIN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const bare = v => String(v || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#\s]/)[0];
const line = (v, n = 120) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n);
const list = (v, n, len) => (Array.isArray(v) ? v : []).slice(0, n).map(x => line(x, len)).filter(Boolean);

// text = jawaban agent (boleh ada teks lain di sekitar JSON). own = domain situs sendiri. skip = domain yang diabaikan.
function parse(text, own, skip = []) {
  const m = /\{[\s\S]*\}/.exec(String(text || '')); let j = {};
  try { j = JSON.parse(m ? m[0] : '{}'); } catch (_) { j = {}; }
  const ownBare = bare(own), ign = new Set(skip.map(bare)), seen = new Set(), items = [];
  for (const x of Array.isArray(j.competitors) ? j.competitors.slice(0, 20) : []) {
    const d = bare(x && x.domain);
    if (!DOMAIN.test(d) || d.length > 100 || d === ownBare || BLOCK.test(d) || ign.has(d) || seen.has(d)) continue; seen.add(d);
    items.push({ domain: d, url: 'https://' + d, reason: line(x.alasan || x.reason, 200) });
  }
  return { items, basis: { services: list(j.layanan_utama || j.services, 12, 80), keywords: list(j.keyword || j.keywords, 20, 80) } };
}
// Dipanggil delegate-job.js saat tugas "cari kompetitor" selesai: simpan ke data/audit/competitors/candidates.json
function save(auditDir, job, site) {
  let own = ''; try { own = new URL(site).hostname; } catch (_) { /* tanpa situs */ }
  const r = parse(job.result, own), file = path.join(auditDir, 'competitors', 'candidates.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = { generatedAt: new Date().toISOString(), source: 'agent', agent: job.agent, items: r.items, basis: r.basis, error: r.items.length ? null : 'Agent tidak mengembalikan domain yang valid. Buka tab Rencana Perbaikan → "Tugas yang didelegasikan" untuk membaca jawabannya.' };
  const t = file + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(out)); fs.renameSync(t, file); return out;
}

// Hasil cek peringkat Google oleh agent: {"hasil":[{"keyword":"...","top":["domain1","domain2",...]}]}.
// Hanya keyword yang memang diminta yang diterima; domain divalidasi dan urutannya dipertahankan (posisi 1 = pertama).
function parseSerp(text, requested) {
  const m = /\{[\s\S]*\}/.exec(String(text || '')); let j = {}; try { j = JSON.parse(m ? m[0] : '{}'); } catch (_) { j = {}; }
  const want = new Map((requested || []).map(k => [String(k).toLowerCase().trim(), k])), items = [], seen = new Set();
  for (const r of Array.isArray(j.hasil || j.results) ? (j.hasil || j.results).slice(0, 20) : []) {
    const key = String((r && (r.keyword || r.query)) || '').toLowerCase().trim(); if (!want.has(key) || seen.has(key)) continue; seen.add(key);
    const top = [], dup = new Set();
    for (const d0 of Array.isArray(r.top) ? r.top.slice(0, 12) : []) { const d = bare(d0); if (DOMAIN.test(d) && d.length <= 100 && !dup.has(d)) { dup.add(d); top.push(d); } }
    items.push({ q: want.get(key), top: top.slice(0, 10) });
  }
  return items;
}
function saveSerp(auditDir, job) {
  const items = parseSerp(job.result, job.keywords), file = path.join(auditDir, 'competitors', 'serp.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = { generatedAt: new Date().toISOString(), agent: job.agent, items, error: items.length ? null : 'Agent tidak mengembalikan hasil yang valid. Baca jawabannya di Rencana Perbaikan → Tugas ke agent.' };
  const t = file + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(out)); fs.renameSync(t, file); return out;
}
module.exports = { parse, save, parseSerp, saveSerp, BLOCK, bare };
