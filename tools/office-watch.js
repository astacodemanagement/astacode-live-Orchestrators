// Pengamat proses: setiap kali agent memanggil rekan dengan `hermes -p <rekan> -z "..."` (cara yang sudah
// dipakai profile seperti astacode-workflow), kantor virtual menampilkannya:
//   pemanggil berjalan ke meja rekan -> rekan bekerja -> saat proses selesai, rekan melapor balik.
// HANYA MEMBACA /proc milik user yang sama; tidak menulis apa pun ke Hermes. Di luar Linux otomatis nonaktif.
// Panggilan lewat tools/delegate.py dilewati karena skrip itu sudah mengirim event sendiri (lebih lengkap).
const fs = require('fs'), path = require('path');

const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const short = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// Sumber data /proc (bisa diganti saat pengujian).
const procFs = {
  available: () => fs.existsSync('/proc/self/stat'),
  pids: () => fs.readdirSync('/proc').filter(d => /^\d+$/.test(d)).map(Number),
  uid: pid => { try { return fs.statSync('/proc/' + pid).uid; } catch (e) { return -1; } },
  argv: pid => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch (e) { return null; } },
  ppid: pid => { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return +s.slice(s.lastIndexOf(')') + 2).split(' ')[1]; } catch (e) { return 0; } },
  env: pid => { try { return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0'); } catch (e) { return []; } },
};

// `hermes -p seo -z "..."` -> { target: 'seo', prompt }   (launcher Hermes = python -c '...hermes_cli...' + argumen)
function parseHermes(argv) {
  if (!argv || !argv.some(a => /hermes_cli|(^|\/)hermes$/.test(a))) return null;
  let target = null, prompt = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--profile') target = argv[i + 1];
    else if (a.startsWith('--profile=')) target = a.slice(10);
    else if (a === '-z') prompt = argv[i + 1] || '';
  }
  return target && prompt !== null ? { target: target.toLowerCase(), prompt } : null;
}

function profileFromHome(home, hermesRoot) {
  if (!home) return null;
  const h = path.resolve(home), r = path.resolve(hermesRoot);
  if (h === r) return 'default';
  const m = h.match(/\/profiles\/([^/]+)\/?$/);
  return m ? m[1].toLowerCase() : null;
}

module.exports = function startWatch({ addEvent, hermesRoot, nameOf, ownerCall, hasCeoTask, ceoTaskAgents = () => [], proc = procFs, interval = 2000 }) {
  if (!proc.available()) { console.log('Pengamat proses nonaktif (bukan Linux).'); return null; }
  const me = proc.uid(process.pid), tracked = new Map(), ignored = new Set();

  function inspect(pid) {
    const info = parseHermes(proc.argv(pid));
    if (!info || !ID_RE.test(info.target)) return null;
    // Telusuri induk: lewati panggilan dari delegate.py; cari profile pemanggil.
    let caller = null, p = proc.ppid(pid);
    for (let depth = 0; p > 1 && depth < 20; depth++, p = proc.ppid(p)) {
      const argv = proc.argv(p) || [];
      if (argv.some(a => a.endsWith('delegate.py'))) return { skip: true };
      const parent = parseHermes(argv);
      if (parent && parent.target === info.target) continue;          // pembungkus shell dari proses yang sama
      if (parent) { caller = parent.target; break; }                    // delegasi berantai
      const home = (proc.env(p).find(e => e.startsWith('HERMES_HOME=')) || '').slice(12);
      caller = profileFromHome(home, hermesRoot);
      if (caller) break;
    }
    return { ...info, caller: caller && caller !== info.target ? caller : null };
  }

  function tick() {
    let pids; try { pids = proc.pids(); } catch (e) { return; }
    const alive = new Set(pids);
    for (const pid of pids) {
      if (tracked.has(pid) || ignored.has(pid) || proc.uid(pid) !== me) continue;
      const r = inspect(pid);
      if (!r || r.skip) { ignored.add(pid); continue; }
      // Pembungkus shell + proses python dengan target sama: catat sekali saja.
      if ([...tracked.values()].some(t => t.target === r.target && t.caller === r.caller && alive.has(t.pid) && proc.ppid(pid) === t.pid)) { ignored.add(pid); continue; }
      // Gateway melayani semua profile dalam satu proses: kalau pemanggil terbaca 'default' tapi yang sedang
      // memegang DM CEO hanya satu agent lain, anggap agent itulah pemanggilnya.
      if (!r.caller || r.caller === 'default') {
        const busy = ceoTaskAgents().filter(id => id !== r.target && id !== 'default');
        if (busy.length === 1 && !(r.caller === 'default' && hasCeoTask('default'))) r.caller = busy[0];
      }
      const taskId = 'proc-' + pid, task = short(r.prompt, 600);
      tracked.set(pid, { pid, target: r.target, caller: r.caller, taskId });
      if (r.caller) {
        const owner = hasCeoTask(r.caller) ? ` dari ${ownerCall()}` : '';
        addEvent({ type: 'talk', agent: r.caller, target: r.target, message: `Tolong kerjain tugas${owner}: ${short(r.prompt, 140)}` });
        addEvent({ type: 'dm', agent: r.target, from: r.caller, channel: 'internal', message: task, task_id: taskId });
      } else {
        addEvent({ type: 'work', agent: r.target, task: 'Tugas otomatis', message: 'Mengerjakan tugas: ' + short(r.prompt, 120), progress: 10 });
      }
    }
    for (const [pid, t] of tracked) {
      if (alive.has(pid)) continue;
      tracked.delete(pid);
      if (t.caller) addEvent({ type: 'report', agent: t.target, to: t.caller, task_id: t.taskId, message: `Tugas selesai, hasilnya sudah saya serahkan ke ${nameOf(t.caller)}.` });
      else addEvent({ type: 'idle', agent: t.target });
    }
    for (const pid of ignored) if (!alive.has(pid)) ignored.delete(pid);
  }

  const timer = setInterval(tick, interval); timer.unref && timer.unref();
  console.log('Pengamat proses aktif: panggilan `hermes -p <profile> -z` akan tampil di kantor.');
  return { tick, stop: () => clearInterval(timer) };
};
module.exports.parseHermes = parseHermes;
module.exports.profileFromHome = profileFromHome;
