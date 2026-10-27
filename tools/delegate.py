#!/usr/bin/env python3
"""Delegasi tugas antar profile Hermes + animasi di kantor virtual.

  python3 ~/astacode-office/tools/delegate.py --list
  python3 ~/astacode-office/tools/delegate.py --from galih --to seo --task "Riset 10 keyword ..."

Alur: pemberi tugas berjalan ke meja rekan (event talk) -> rekan menerima tugas (dm internal)
-> rekan dikerjakan sungguhan oleh Hermes (`hermes -p <rekan> -z`) -> rekan berjalan kembali
membawa hasil (report). Hasil lengkap dicetak ke stdout untuk dibaca agent pemberi tugas.

Dipakai oleh skill `tim-kantor`. Hanya library standar Python.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
MAX_DEPTH = 2          # rekan boleh mendelegasikan lagi satu tingkat, tidak lebih
HEARTBEAT = 25         # detik antar kabar "masih dikerjakan" ke kantor


def load_env():
    env = {}
    for f in (Path.home() / ".astacode-office.env", APP_DIR / ".astacode-office.env"):
        if f.is_file():
            for line in f.read_text().splitlines():
                m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
                if m:
                    env.setdefault(m.group(1), m.group(2).strip("'\""))
    return env


ENV = load_env()
HERMES_ROOT = Path(ENV.get("HERMES_ROOT") or Path.home() / ".hermes")
OFFICE_URL = f"http://127.0.0.1:{ENV.get('PORT', '8787')}/api/office/events"


def meta():
    try:
        return json.loads((APP_DIR / "config" / "agents.json").read_text())
    except Exception:
        return {}


def profiles():
    ids = []
    if (HERMES_ROOT / "config.yaml").is_file():
        ids.append("default")
    d = HERMES_ROOT / "profiles"
    if d.is_dir():
        ids += sorted(p.name for p in d.iterdir() if (p / "config.yaml").is_file())
    m = meta()
    return [i for i in ids if not m.get(i, {}).get("hide")]


def name_of(pid):
    m = meta().get(pid, {})
    return m.get("name") or ("Hermes" if pid == "default" else pid.replace("-", " ").replace("_", " ").title())


def owner_call():
    c = meta().get("ceo", {})
    return c.get("call") or c.get("name") or "CEO"


def post(payload):
    headers = {"Content-Type": "application/json"}
    if ENV.get("OFFICE_TOKEN"):
        headers["X-Office-Token"] = ENV["OFFICE_TOKEN"]
    req = urllib.request.Request(OFFICE_URL, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as e:  # kantor virtual tidak boleh menggagalkan tugas
        print(f"[kantor] gagal kirim event: {e}", file=sys.stderr)


def short(text, n):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def hermes_bin():
    return shutil.which("hermes") or str(Path.home() / ".local" / "bin" / "hermes")


def main():
    ap = argparse.ArgumentParser(description="Delegasikan tugas ke profile Hermes lain")
    ap.add_argument("--list", action="store_true", help="tampilkan rekan tim")
    ap.add_argument("--from", dest="src", help="profile pemberi tugas (profile kamu)")
    ap.add_argument("--to", dest="dst", help="profile rekan yang mengerjakan")
    ap.add_argument("--task", help="isi tugas, lengkap dan berdiri sendiri")
    ap.add_argument("--timeout", type=int, default=1500, help="batas waktu detik (default 1500)")
    a = ap.parse_args()

    team = profiles()
    if a.list:
        m = meta()
        for pid in team:
            role = m.get(pid, {}).get("role", "")
            print(f"{pid:<22} {name_of(pid)}" + (f" ({role})" if role else ""))
        return 0

    if not (a.src and a.dst and a.task):
        ap.error("--from, --to, dan --task wajib diisi (atau pakai --list)")
    src, dst = a.src.strip().lower(), a.dst.strip().lower()
    if dst not in team:
        print(f"Profile '{dst}' tidak ada. Rekan yang tersedia: {', '.join(team)}", file=sys.stderr)
        return 2
    if src == dst:
        print("Tidak bisa mendelegasikan ke diri sendiri.", file=sys.stderr)
        return 2
    depth = int(os.getenv("OFFICE_DELEGATE_DEPTH", "0"))
    if depth >= MAX_DEPTH:
        print("Batas delegasi berantai tercapai. Kerjakan sendiri atau laporkan ke pemberi tugas.", file=sys.stderr)
        return 3

    owner, src_name, dst_name = owner_call(), name_of(src), name_of(dst)
    task_id = f"{src}>{dst}-{int(time.time()) % 1000000}"

    # 1) pemberi tugas mendatangi rekan; 2) rekan menerima tugas saat didatangi
    post({"type": "talk", "agent": src, "target": dst, "message": f"Tolong kerjain tugas dari {owner}: {short(a.task, 140)}"})
    post({"type": "dm", "agent": dst, "from": src, "channel": "internal", "message": a.task, "task_id": task_id})

    prompt = (
        f"Kamu menerima tugas dari rekanmu {src_name} (atas permintaan {owner}).\n\n"
        f"TUGAS:\n{a.task}\n\n"
        f"Kerjakan sebaik mungkin. Di akhir, tulis hasil kerjamu secara lengkap dan rapi untuk {src_name}; "
        f"jawaban akhirmu akan langsung diteruskan kepadanya."
    )
    env = dict(os.environ, OFFICE_DELEGATE_DEPTH=str(depth + 1))
    done = threading.Event()

    def heartbeat():
        n = 0
        while not done.wait(HEARTBEAT):
            n += 1
            post({"type": "work", "agent": dst, "task_id": task_id, "progress": min(90, 15 + n * 12),
                  "message": f"Masih mengerjakan tugas dari {src_name}…"})

    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        r = subprocess.run([hermes_bin(), "-p", dst, "-z", prompt], cwd=str(Path.home()), env=env,
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=a.timeout)
        out, ok = (r.stdout or "").strip(), r.returncode == 0 and bool((r.stdout or "").strip())
        err = (r.stderr or "").strip()
    except subprocess.TimeoutExpired:
        out, ok, err = "", False, f"melewati batas waktu {a.timeout} detik"
    except Exception as e:
        out, ok, err = "", False, str(e)
    finally:
        done.set()

    if ok:
        post({"type": "report", "agent": dst, "to": src, "task_id": task_id, "message": short(out, 400)})
        print(f"HASIL DARI {dst_name} ({dst}):\n\n{out}")
        return 0
    post({"type": "report", "agent": dst, "to": src, "task_id": task_id,
          "message": f"Maaf, tugas belum berhasil: {short(err or 'tidak ada jawaban', 160)}"})
    print(f"Delegasi ke {dst} gagal: {err or 'tidak ada jawaban'}\n{short(out, 2000)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
