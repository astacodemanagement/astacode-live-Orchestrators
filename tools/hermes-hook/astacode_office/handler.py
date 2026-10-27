"""Hook Hermes -> kantor virtual Astacode.

Setiap profile Hermes tampil sebagai satu karakter di kantor (id karakter = nama profile).

agent:start  -> event `dm`     (pesan Anda muncul di atas kepala agent, agent mulai bekerja)
agent:step   -> event `work`   (agent mengetik di meja, tool yang dipakai tampil sebagai gelembung)
agent:end    -> event `report` (agent berjalan ke meja CEO dan menyampaikan balasannya)

Pasang di <HERMES_HOME>/hooks/astacode_office/ untuk tiap profile, lalu restart gateway.
Pengaturan lewat .env profile (opsional):
  OFFICE_URL       default http://127.0.0.1:8787/api/office/events
  OFFICE_TOKEN     dikirim sebagai header X-Office-Token
  OFFICE_AGENT     id karakter untuk profile ini (default: nama profile)
  OFFICE_PLATFORMS default telegram  (pisahkan dengan koma, atau * untuk semua)
"""

import itertools
import json
import os
import queue
import threading
import time
import urllib.request
from pathlib import Path

# .../<HERMES_HOME>/hooks/astacode_office/handler.py
# Profile bernama ada di <root>/profiles/<nama>; selain itu ini home utama (di mana pun letaknya, mis. /var/www/hermes).
_home = Path(__file__).resolve().parents[2]
PROFILE = _home.name.lower() if _home.parent.name == "profiles" else "default"

STEP_EVERY = 4  # detik minimal antar event `work` per sesi, supaya kantor tidak banjir gelembung

_turns = {}  # session_id -> {"id": task_id, "last_step": waktu, "tools": tuple}
_counter = itertools.count(1)
_outbox = queue.Queue(maxsize=200)


def _agent():
    return os.getenv("OFFICE_AGENT") or PROFILE


def _platform_ok(platform):
    allowed = os.getenv("OFFICE_PLATFORMS", "telegram").replace(" ", "")
    return allowed == "*" or platform in allowed.split(",")


def _post(payload):
    url = os.getenv("OFFICE_URL", "http://127.0.0.1:8787/api/office/events")
    headers = {"Content-Type": "application/json"}
    if os.getenv("OFFICE_TOKEN"):
        headers["X-Office-Token"] = os.environ["OFFICE_TOKEN"]
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as e:
        print(f"[astacode_office] gagal kirim ke {url}: {e}", flush=True)


def _worker():
    # Satu antrean, satu pengirim: urutan dm -> work -> report tetap terjaga.
    while True:
        _post(_outbox.get())


threading.Thread(target=_worker, name="astacode_office", daemon=True).start()


def _send(payload):
    try:
        _outbox.put_nowait(payload)
    except queue.Full:
        pass  # kantor virtual tidak boleh menahan balasan Telegram


def handle(event_type, context):
    if not _platform_ok(context.get("platform", "")):
        return
    agent = _agent()
    session = str(context.get("session_id", ""))

    if event_type == "agent:start":
        task_id = f"{PROFILE}-{next(_counter)}-{int(time.time()) % 100000}"
        _turns[session] = {"id": task_id, "last_step": 0.0, "tools": ()}
        _turns[session]["user"] = str(context.get("user_id") or "")
        # "user" = ID Telegram pengirim; server kantor memetakannya ke karakter (agents.json "users"), lalu membuangnya.
        _send({"type": "dm", "agent": agent, "from": "ceo", "user": _turns[session]["user"],
               "message": context.get("message", ""), "task_id": task_id})

    elif event_type == "agent:step":
        turn = _turns.get(session)
        tools = tuple(context.get("tool_names") or ())
        if not turn or not tools:
            return
        now = time.monotonic()
        if tools == turn["tools"] or now - turn["last_step"] < STEP_EVERY:
            return
        turn["last_step"], turn["tools"] = now, tools
        _send({"type": "work", "agent": agent, "task_id": turn["id"],
               "message": "Memakai " + ", ".join(tools[:3])})

    elif event_type == "agent:end":
        turn = _turns.pop(session, None)
        user = str(context.get("user_id") or (turn or {}).get("user") or "")
        _send({"type": "report", "agent": agent, "to": "ceo", "user": user, "task_id": turn["id"] if turn else None,
               "message": context.get("response") or "Tugas selesai."})
