#!/usr/bin/env node
'use strict';
// Audit situs + Core Web Vitals + pemantau kompetitor. Hasil disimpan sebagai JSON dan ditampilkan di popup "Performa Web".
//   node tools/seo-audit.js --kind all|site|competitors [--site URL] [--max N] [--quick]
// Konfigurasi: config/seo-audit.json  ·  Data: data/audit/  ·  API key PageSpeed: env PSI_API_KEY (opsional)
const fs = require('fs'), path = require('path'), os = require('os');
const { crawlSite } = require('./audit/crawl');
const { runChecks, CATS } = require('./audit/checks');
const { computeScore } = require('./audit/score');
const { runVitals, speedScores, vitalsIssues } = require('./audit/vitals');
const AI = require('./audit/ai');
const { analyze } = require('./audit/compare');
const { buildRecs } = require('./audit/plan');
const C = require('./audit/compete');
const H = require('./audit/http');

const ROOT = path.join(__dirname, '..');
const DIR = process.env.OFFICE_AUDIT_DIR || path.join(ROOT, 'data', 'audit');
const CFG_FILE = process.env.OFFICE_AUDIT_CONFIG || path.join(ROOT, 'config', 'seo-audit.json');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const kind = arg('kind', 'all');

function loadConfig() {
  let u = {}; try { u = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('config/seo-audit.json tidak valid:', e.message); }
  const c = { site: 'https://astacode.id', maxPages: 300, maxDepth: 8, rate: 3, concurrency: 3, maxExternal: 150, maxAssets: 200, keyPages: [], competitors: [], competitorSample: 20, competitorDelayMs: 1500,
    ...u, psi: { enabled: true, strategies: ['mobile', 'desktop'], maxUrls: 6, competitors: true, ...(u.psi || {}) },
    autoTrack: u.autoTrack == null ? 3 : u.autoTrack, ignoredCompetitors: u.ignoredCompetitors || [] };
  if (arg('site')) c.site = String(arg('site')); if (arg('max')) c.maxPages = parseInt(arg('max'), 10) || c.maxPages;
  if (arg('quick')) { c.maxPages = Math.min(c.maxPages, 25); c.maxExternal = 20; c.maxAssets = 30; c.competitorSample = 6; }
  c.competitors = (c.competitors || []).map(x => typeof x === 'string' ? { url: x } : x).filter(x => x && x.url).map(x => ({ ...x, url: /^https?:/i.test(x.url) ? x.url : 'https://' + x.url }));
  return c;
}
const cfg = loadConfig();
const log = m => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, f); };

// ---- kunci & progres (dibaca server kantor untuk menampilkan status)
const RUN = path.join(DIR, 'running.json'); let lastProg = 0, runState = { pid: process.pid, kind, startedAt: new Date().toISOString(), phase: 'mulai', done: 0, total: 0 };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
function lock() { const cur = readJson(RUN); if (cur && cur.pid !== process.pid && alive(cur.pid) && Date.now() - Date.parse(cur.startedAt) < 3 * 3600e3) { console.error('Audit lain sedang berjalan (PID ' + cur.pid + ').'); process.exit(3); } writeJson(RUN, runState); }
function progress(p) { Object.assign(runState, p); if (Date.now() - lastProg > 1000) { lastProg = Date.now(); try { writeJson(RUN, runState); } catch (_) { /* abaikan */ } } }
function unlock() { try { const cur = readJson(RUN); if (cur && cur.pid === process.pid) fs.unlinkSync(RUN); } catch (_) { /* abaikan */ } }

// ---- audit situs
const SEO_DIR = process.env.OFFICE_SEO_DIR || path.join(os.homedir(), 'seo', 'data', 'comproasta', 'latest');
async function runSite() {
  const t0 = Date.now(); progress({ phase: 'crawl', done: 0, total: cfg.maxPages });
  log('Audit situs ' + cfg.site + ' (maks ' + cfg.maxPages + ' halaman, ' + cfg.rate + ' permintaan/detik)');
  const model = await crawlSite(cfg, { log, progress });
  progress({ phase: 'analisis' });
  const res = runChecks(model, cfg), home = H.norm(model.site, model.origin);
  // AI Search Health: dinilai dari halaman HTML yang dapat diindeks + robots.txt + llms.txt + sitemap
  const noindex = p => /noindex/.test(p.parsed.robots || '') || /noindex/i.test((p.headers && p.headers['x-robots-tag']) || '');
  const aiPages = model.pages.filter(p => p.parsed && p.finalStatus === 200 && !noindex(p)).map(p => ({ url: p.url, parsed: p.parsed }));
  const ai = AI.assess({ pages: aiPages, robotsText: model.robots.body || '', robotsStatus: model.robots.status, llms: model.llms, sitemapEntries: model.sitemap.urls, allUrls: [...model.pages.map(p => p.url), ...model.sitemap.urls.map(e => e.loc)], origin: model.origin, homeUrl: home });
  res.issues.push(...AI.aiIssues(ai, model.site));
  // Core Web Vitals + skor kecepatan (mobile & desktop)
  let vitals = { skipped: 'dinonaktifkan di config', items: [] };
  if (cfg.psi.enabled) {
    const top = model.pages.filter(p => p.parsed && p.finalStatus === 200 && p.url !== home).sort((a, b) => b.inlinkCount - a.inlinkCount).map(p => p.url);
    const urls = (cfg.keyPages.length ? cfg.keyPages.map(u => H.norm(u, model.origin)) : [model.site, ...top]).filter(Boolean).slice(0, cfg.psi.maxUrls);
    progress({ phase: 'web vitals', done: 0, total: urls.length * cfg.psi.strategies.length });
    vitals = await runVitals(urls, { key: process.env.PSI_API_KEY, strategies: cfg.psi.strategies, log, onItem: (n, tot) => progress({ done: n, total: tot }) });
  }
  const speed = speedScores(vitals, model.site); res.issues.push(...vitalsIssues(vitals));
  res.issues.sort((a, b) => ({ error: 0, warning: 1, notice: 2 }[a.severity] - { error: 0, warning: 1, notice: 2 }[b.severity]) || b.count - a.count);
  const sc = computeScore(res.issues, res.htmlCount || 1, CATS);
  const prev = readJson(path.join(DIR, 'site', 'latest.json'));
  // bandingkan dengan crawl sebelumnya
  const prevMap = new Map(prev ? prev.issues.map(i => [i.id, i]) : []);
  for (const is of res.issues) { const p = prevMap.get(is.id); is.prevCount = p ? p.count : 0;
    const before = new Set(p ? p.items.map(i => i.url) : []), now = new Set(is.items.map(i => i.url));
    is.newCount = prev ? is.items.filter(i => !before.has(i.url)).length : null; is.fixedCount = prev && p ? [...before].filter(u => !now.has(u)).length : null; }
  const resolved = prev ? prev.issues.filter(p => !res.issues.some(i => i.id === p.id)).map(p => ({ id: p.id, title: p.title, severity: p.severity, prevCount: p.count })) : [];
  const counts = { errors: 0, warnings: 0, notices: 0 }; for (const i of res.issues) counts[i.severity === 'error' ? 'errors' : i.severity === 'warning' ? 'warnings' : 'notices'] += i.count;
  counts.issueTypes = res.issues.length;
  const scores = { health: sc.score, seo: sc.seo, ai: ai.score, speedMobile: speed.mobile ? speed.mobile.score : null, speedDesktop: speed.desktop ? speed.desktop.score : null };
  const report = { version: 2, site: model.site, generatedAt: new Date().toISOString(), durationSec: Math.round((Date.now() - t0) / 1000),
    crawl: { fetched: model.fetched, truncated: model.truncated, notCrawled: model.notCrawled, maxPages: cfg.maxPages, htmlPages: res.htmlCount, indexable: res.indexable, robots: model.robots && { status: model.robots.status, blocksAll: model.robots.blocksAll },
      sitemap: { found: model.sitemap.found, files: model.sitemap.files, urls: model.sitemap.urls.length, errors: model.sitemap.errors }, externalChecked: model.externals.length, assetsChecked: model.assets.length },
    score: sc.score, prevScore: prev ? prev.score : null, scores, prevScores: prev ? (prev.scores || { health: prev.score }) : null, categories: sc.categories, counts, prevCounts: prev ? prev.counts : null, issues: res.issues, resolved, pages: res.pages, vitals, speed,
    ai: { score: ai.score, components: ai.components, blockedBots: ai.blockedBots, okBots: ai.okBots, pagesAssessed: ai.pagesAssessed, llms: model.llms && { found: model.llms.found } } };
  if (prev) writeJson(path.join(DIR, 'site', 'previous.json'), prev);
  writeJson(path.join(DIR, 'site', 'latest.json'), report);
  const hist = (readJson(path.join(DIR, 'site', 'history.json')) || []).filter(h => h.date !== report.generatedAt.slice(0, 10));
  hist.push({ date: report.generatedAt.slice(0, 10), score: sc.score, seo: scores.seo, ai: scores.ai, speedMobile: scores.speedMobile, speedDesktop: scores.speedDesktop, errors: counts.errors, warnings: counts.warnings, notices: counts.notices, pages: model.fetched });
  writeJson(path.join(DIR, 'site', 'history.json'), hist.slice(-400));
  writePlan();
  log('SELESAI audit situs: kesehatan ' + sc.score + ' · SEO ' + scores.seo + ' · AI ' + scores.ai + (scores.speedMobile != null ? ' · mobile ' + scores.speedMobile + ' · desktop ' + (scores.speedDesktop ?? '–') : '') + ' · ' + counts.errors + ' error, ' + counts.warnings + ' warning, ' + counts.notices + ' notice · ' + model.fetched + ' halaman · ' + report.durationSec + ' detik');
  return report;
}
// Rencana perbaikan = masalah audit situs + celah dari analisis kompetitor, diurutkan menurut prioritas.
function writePlan() {
  const site = readJson(path.join(DIR, 'site', 'latest.json')), comp = readJson(path.join(DIR, 'competitors', 'latest.json'));
  if (!site) return;
  const recs = buildRecs(site.issues, site.site, comp && comp.analysis ? comp.analysis.recs || [] : []);
  writeJson(path.join(DIR, 'plan.json'), { version: 1, generatedAt: new Date().toISOString(), site: site.site, auditAt: site.generatedAt, competitorsAt: comp ? comp.generatedAt : null, recs });
}

// ---- kompetitor
const KEY = () => process.env.PSI_API_KEY;
async function psiHome(url, strategies = ['mobile', 'desktop']) {
  if (!cfg.psi.enabled || !KEY()) return null;
  const v = await runVitals([url], { key: KEY(), strategies, log }), out = {};
  for (const i of v.items) if (i.ok) out[i.strategy] = { perf: i.perf, lab: i.lab, ratings: i.ratings };
  return Object.keys(out).length ? out : null;
}
// Daftar kompetitor yang dianalisis: daftar manual di config; bila kosong, kandidat teratas yang ditemukan agent (candidates.json), kecuali yang diabaikan.
async function pickTargets() {
  const cand = readJson(path.join(DIR, 'competitors', 'candidates.json'));
  if (cfg.competitors.length) return { targets: cfg.competitors, auto: false, cand };
  const ign = new Set(cfg.ignoredCompetitors.map(x => String(x).toLowerCase()));
  const auto = ((cand && cand.items) || []).filter(c => !ign.has(c.domain)).slice(0, cfg.autoTrack).map(c => ({ url: c.url, name: c.domain, auto: true }));
  return { targets: auto, auto: true, cand };
}
async function runCompetitors() {
  const picked = await pickTargets();
  if (!picked.targets.length) { log('Belum ada kompetitor (config kosong dan agent belum mencari); dilewati. Klik "Minta agent mencari kompetitor" di tab Kompetitor.'); return null; }
  const t0 = Date.now(), stateFile = path.join(DIR, 'competitors', 'state.json'), state = readJson(stateFile) || { domains: {} };
  const targets = [{ url: cfg.site, name: 'Situs Anda', self: true }, ...picked.targets];
  const siteRep = readJson(path.join(DIR, 'site', 'latest.json')), fresh = siteRep && (Date.now() - Date.parse(siteRep.generatedAt)) < 6 * 3600e3;
  const out = [], full = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]; progress({ phase: 'kompetitor ' + (t.name || t.url), done: i, total: targets.length });
    log('Kompetitor: ' + t.url);
    let snap; try { snap = await C.snapshotSite(t.url, { maxSample: cfg.competitorSample, delayMs: t.self ? 500 : cfg.competitorDelayMs, log }); }
    catch (e) { snap = { domain: new URL(t.url).hostname, url: t.url, ok: false, error: e.message, fetchedAt: new Date().toISOString(), sitemap: { urls: 0, entries: [] }, sample: [], metrics: {}, tech: [], topics: [] }; }
    const diff = snap.ok ? C.updateState(state, snap) : { isFirst: false, newUrls: [], removed: [], changes: [] };
    const d = state.domains[snap.domain] || { history: [], changes: [], newPages: [], firstSeen: {} };
    let psi = null;
    if (snap.ok && (t.self || cfg.psi.competitors)) {
      if (t.self && fresh && siteRep.vitals && siteRep.vitals.items) { const o = {}; for (const v of siteRep.vitals.items) if (v.ok && v.url === siteRep.site) o[v.strategy] = { perf: v.perf, lab: v.lab, ratings: v.ratings }; psi = Object.keys(o).length ? o : null; }
      else psi = await psiHome(snap.url + '/');
    }
    const item = { name: t.name || snap.domain, domain: snap.domain, url: snap.url, self: !!t.self, auto: !!t.auto, ok: snap.ok, blocked: !!snap.blocked, error: snap.error || null, fetchedAt: snap.fetchedAt,
      robots: snap.robots, llms: snap.llms || null, sitemap: { urls: snap.sitemap.urls, files: snap.sitemap.files, truncated: !!snap.sitemap.truncated, updated7: snap.sitemap.updated7, updated30: snap.sitemap.updated30, updated90: snap.sitemap.updated90 },
      metrics: snap.metrics, tech: snap.tech, ai: snap.ai || null, psi,
      home: snap.home ? { title: snap.home.title, metaDescription: snap.home.metaDescription, h1: (snap.home.h1 || [])[0] || '', ttfb: snap.home.ttfb, https: snap.home.https, hsts: snap.home.hsts, compressed: snap.home.compressed } : null,
      isFirst: diff.isFirst, newNow: diff.newUrls.length, removedNow: diff.removed.length, new7: C.new7(d), new30: C.new30(d), newPages: (d.newPages || []).slice(0, 15), changes: (d.changes || []).slice(0, 15),
      recent: (snap.sitemap.entries || []).filter(e => e.lastmod).sort((a, b) => b.lastmod.localeCompare(a.lastmod)).slice(0, 8).map(e => ({ url: e.loc, lastmod: e.lastmod })), history: (d.history || []).slice(-60) };
    full.push({ ...item, topics: snap.topics || [] }); out.push({ ...item, topics: (snap.topics || []).slice(0, 40) });
  }
  writeJson(stateFile, state);
  const analysis = analyze(full); for (const it of out) it.scores = analysis.scores[it.domain] || null;
  const rep = { version: 2, generatedAt: new Date().toISOString(), durationSec: Math.round((Date.now() - t0) / 1000), auto: picked.auto, items: out, analysis: { ...analysis, topicGap: analysis.topicGap } };
  writeJson(path.join(DIR, 'competitors', 'latest.json'), rep); writePlan();
  log('SELESAI kompetitor: ' + out.map(o => o.domain + (o.ok ? '' : ' (gagal)')).join(', ') + (analysis.rank ? ' · posisi Anda #' + analysis.rank.pos + ' dari ' + analysis.rank.of : ''));
  return rep;
}

(async () => {
  try { os.setPriority(0, 10); } catch (_) { /* tidak wajib */ }
  fs.mkdirSync(DIR, { recursive: true }); lock();
  process.on('SIGTERM', () => { unlock(); process.exit(143); }); process.on('SIGINT', () => { unlock(); process.exit(130); });
  try {
    if (kind === 'all' || kind === 'site') await runSite();
    if (kind === 'all' || kind === 'competitors') await runCompetitors();
  } catch (e) { console.error('Audit gagal:', e && e.stack || e); process.exitCode = 1; }
  finally { unlock(); }
})();
