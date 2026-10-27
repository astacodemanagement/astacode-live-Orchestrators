#!/usr/bin/env bash
# Potret kondisi Hermes (HANYA MEMBACA, tidak mengubah apa pun, tidak menulis file di VPS).
# Jalankan dari laptop, hasil langsung tersimpan di laptop:
#   ssh root@IP-VPS 'bash -s' < tools/hermes-audit.sh > ~/Downloads/hermes-audit.txt
# Nilai rahasia disensor: .env hanya nama variabel, baris key/token/secret/password di config disamarkan,
# pola token Telegram/GitHub/API key dan private key diganti ***.

H="${HERMES_ROOT:-/home/agent/.hermes}"
AU="${AGENT_USER:-agent}"
HB="$(getent passwd "$AU" | cut -d: -f6)/.local/bin/hermes"

redact() {
  sed -E \
    -e 's/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/***TOKEN-TELEGRAM***/g' \
    -e 's/(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr])[-_][A-Za-z0-9_-]{12,}/***RAHASIA***/g' \
    -e 's/AIza[0-9A-Za-z_-]{20,}/***RAHASIA***/g' \
    -e 's/-----BEGIN[A-Z ]*PRIVATE KEY-----.*/***PRIVATE KEY***/g' \
    -e 's/"private_key"[^,]*/"private_key": "***"/g'
}

{
echo "=== WAKTU: $(date)  HOST: $(hostname)"
echo "=== HERMES_ROOT: $H"
echo; echo "=== VERSI HERMES"; sudo -u "$AU" -H "$HB" --version 2>&1 | head -5
echo; echo "=== DAFTAR PROFILE"; sudo -u "$AU" -H "$HB" profile list 2>&1 | head -40

echo; echo "=== SERVICE SYSTEMD hermes*"
for u in $(systemctl list-unit-files 'hermes*' --no-legend 2>/dev/null | awk '{print $1}'); do
  echo "--- $u: $(systemctl is-active "$u" 2>/dev/null) / $(systemctl is-enabled "$u" 2>/dev/null)"
  systemctl cat "$u" 2>/dev/null | grep -v '^#'
done
echo; echo "=== PROSES GATEWAY YANG JALAN"
ps -eo pid,user,lstart,args | grep -i "[h]ermes" | grep -i gateway | sed -E 's/-c import.*(gateway.*)$/... \1/' | cut -c1-220

BUNDLED="$(find "$H/hermes-agent/skills" "$H/hermes-agent/optional-skills" -name SKILL.md 2>/dev/null | xargs -r -n1 dirname | xargs -r -n1 basename | sort -u)"

for home in "$H" "$H"/profiles/*/; do
  home="${home%/}"; [ -f "$home/config.yaml" ] || continue
  n=default; [ "$home" = "$H" ] || n="$(basename "$home")"
  echo; echo "################################ PROFILE: $n  ($home)"
  echo "=== config.yaml"
  sed -E 's/^([[:space:]]*[A-Za-z0-9_]*(key|token|secret|password|passwd|api)[A-Za-z0-9_]*:[[:space:]]*).+/\1***/I' "$home/config.yaml"
  echo "=== .env (nama variabel saja, tanpa nilai)"
  [ -f "$home/.env" ] && grep -v '^[[:space:]]*#' "$home/.env" | cut -d= -f1 | grep . | tr '\n' ' '; echo
  for f in SOUL.md AGENTS.md USER.md; do [ -f "$home/$f" ] && { echo "=== $f"; head -c 12000 "$home/$f"; echo; }; done
  if [ -d "$home/memories" ]; then
    echo "=== memories/"
    for f in "$home"/memories/*; do [ -f "$f" ] && { echo "--- $(basename "$f")"; head -c 8000 "$f"; echo; }; done
  fi
  echo "=== SKILL (nama + deskripsi)"
  find "$home/skills" -name SKILL.md 2>/dev/null | sort | while read -r s; do
    d="$(grep -m1 '^description:' "$s" | cut -c14-180)"; echo "- ${s#"$home"/skills/}  :: $d"
  done
  echo "=== SKILL BUATAN SENDIRI (isi lengkap; bukan bawaan Hermes)"
  find "$home/skills" -name SKILL.md 2>/dev/null | sort | while read -r s; do
    b="$(basename "$(dirname "$s")")"
    if ! grep -qx "$b" <<<"$BUNDLED"; then echo "--------- ${s#"$home"/skills/}"; head -c 10000 "$s"; echo; fi
  done
  [ -d "$home/skills-disabled" ] && { echo "=== skills-disabled/"; ls "$home/skills-disabled" | tr '\n' ' '; echo; }
  echo "=== hooks/"; ls "$home/hooks" 2>/dev/null | tr '\n' ' '; echo
  if [ -d "$home/cron" ]; then echo "=== cron/"; for f in "$home"/cron/*.json; do [ -f "$f" ] && { echo "--- $(basename "$f")"; head -c 8000 "$f"; echo; }; done; fi
  echo "=== gateway_state.json"; head -c 1500 "$home/gateway_state.json" 2>/dev/null; echo
done

echo; echo "=== CRONTAB user $AU"; crontab -u "$AU" -l 2>/dev/null
echo; echo "=== CRONTAB root (baris terkait agent/hermes/seo)"; crontab -l 2>/dev/null | grep -iE 'agent|hermes|seo|backup'
echo; echo "=== SUDOERS terkait agent"; grep -rlE "^[^#]*\b$AU\b" /etc/sudoers.d 2>/dev/null | while read -r f; do echo "--- $f"; grep -v '^#' "$f"; done
echo; echo "=== /usr/local/bin (pembungkus kustom)"; ls -l /usr/local/bin 2>/dev/null | grep -iE 'seo|hermes|backup|agent'
echo; echo "=== STRUKTUR WORKSPACE agent (3 tingkat)"
find "$(getent passwd "$AU" | cut -d: -f6)/workspace" -maxdepth 3 \( -name .git -o -name node_modules -o -name vendor -o -name .venv \) -prune -o -print 2>/dev/null | head -200
echo; echo "=== GIT REPO di workspace (remote & branch, tanpa kredensial)"
find "$(getent passwd "$AU" | cut -d: -f6)/workspace" -maxdepth 4 -name .git -type d 2>/dev/null | while read -r g; do
  r="$(dirname "$g")"; echo "--- $r"
  sudo -u "$AU" -H git -C "$r" remote -v 2>/dev/null | sed -E 's#://[^@/]+@#://***@#' | sort -u
  sudo -u "$AU" -H git -C "$r" branch --show-current 2>/dev/null
done
echo; echo "=== SELESAI"
} 2>&1 | redact
