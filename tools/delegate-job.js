#!/usr/bin/env node
'use strict';
// Menjalankan satu delegasi (tools/delegate.py) sebagai proses terpisah dan mencatat statusnya di file job.
// Dipisah dari server kantor supaya tugas tetap berjalan walau server dinyalakan ulang.   node tools/delegate-job.js <job.json>
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const file = process.argv[2];
if (!file) { console.error('pakai: node delegate-job.js <job.json>'); process.exit(2); }
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = o => { const t = file + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, file); };
const job = read(); Object.assign(job, { status: 'berjalan', pid: process.pid, startedAt: new Date().toISOString() }); save(job);
let out = '', err = '';
const child = spawn(process.env.OFFICE_PYTHON || 'python3', [path.join(__dirname, 'delegate.py'), '--from', job.from, '--to', job.agent, '--task', job.task, '--timeout', String(job.timeout || 1500)], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
child.stdout.on('data', d => { if (out.length < 60000) out += d; }); child.stderr.on('data', d => { if (err.length < 8000) err += d; });
child.on('error', e => finish(1, 'gagal menjalankan delegate.py: ' + e.message));
child.on('close', code => finish(code, ''));
function finish(code, extra) {
  const j = read(); Object.assign(j, { status: code === 0 ? 'selesai' : 'gagal', finishedAt: new Date().toISOString(), exit: code, result: out.trim().slice(0, 8000), error: (extra || err.trim()).slice(0, 1000) }); delete j.task; save(j);
  // tugas "cari kompetitor": simpan jawaban agent sebagai kandidat (divalidasi ketat, hanya saran)
  if (j.kind === 'discover' && j.status === 'selesai') { try { const auditDir = path.dirname(path.dirname(file)), cfgFile = process.env.OFFICE_AUDIT_CONFIG || path.join(__dirname, '..', 'config', 'seo-audit.json'); let site = 'https://astacode.id'; try { site = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).site || site; } catch (_) { /* bawaan */ } require('./audit/agent-candidates').save(auditDir, j, site); } catch (e) { console.error('gagal menyimpan kandidat:', e.message); } }
  if (j.kind === 'serp' && j.status === 'selesai') { try { require('./audit/agent-candidates').saveSerp(path.dirname(path.dirname(file)), j); } catch (e) { console.error('gagal menyimpan hasil peringkat:', e.message); } }
  process.exit(0);
}
