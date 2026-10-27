#!/usr/bin/env bash
# Pasang kantor virtual + hook Hermes di VPS, tanpa root.
#   bash tools/install-vps.sh
# Hermes tidak di ~/.hermes (mis. di /var/www)? Sebutkan foldernya:
#   HERMES_ROOT=/var/www/hermes bash tools/install-vps.sh
# Aman dijalankan ulang (token & password lama dipakai lagi).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"
# Default hanya bisa dibuka dari VPS sendiri (lewat SSH tunnel). HOST=0.0.0.0 untuk membuka ke publik.
HOST="${HOST:-127.0.0.1}"
# Username/password halaman kantor pilihan sendiri (opsional): OFFICE_USER=galih OFFICE_PASSWORD='...' bash ...
SET_USER="${OFFICE_USER:-}"; SET_PASS="${OFFICE_PASSWORD:-}"
# Token, password & log disimpan di home user; kalau home tidak bisa ditulis (mis. www-data -> /var/www milik root), di folder aplikasi.
STATE_DIR="$HOME"; [ -w "$STATE_DIR" ] || STATE_DIR="$APP_DIR"
ENV_FILE="$STATE_DIR/.astacode-office.env"
LOG_FILE="$STATE_DIR/.astacode-office.log"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# 0. Cari folder Hermes: HERMES_ROOT > HERMES_HOME > ~/.hermes > pencarian di /var/www, /opt, /srv, /home, /root
say "Mencari folder Hermes"
HERMES_ROOT="${HERMES_ROOT:-${HERMES_HOME:-}}"
if [ -z "$HERMES_ROOT" ] && [ -f "$HOME/.hermes/config.yaml" ]; then HERMES_ROOT="$HOME/.hermes"; fi
if [ -z "$HERMES_ROOT" ]; then
  # Home Hermes = folder berisi config.yaml dan salah satu dari profiles/, sessions/, skills/
  CANDIDATES="$(find /var/www /opt /srv /home /root -maxdepth 5 -name config.yaml -not -path '*/profiles/*' -not -path '*/node_modules/*' 2>/dev/null \
    | while read -r f; do d="$(dirname "$f")"; { [ -d "$d/profiles" ] || [ -d "$d/sessions" ] || [ -d "$d/skills" ]; } && echo "$d"; done | sort -u)"
  if [ "$(printf '%s' "$CANDIDATES" | grep -c .)" = 1 ]; then
    HERMES_ROOT="$CANDIDATES"
  else
    echo "Folder Hermes tidak bisa dipastikan otomatis.${CANDIDATES:+ Kandidat:}"
    [ -n "$CANDIDATES" ] && printf '  %s\n' $CANDIDATES
    echo "Jalankan ulang dengan: HERMES_ROOT=/lokasi/hermes bash tools/install-vps.sh"
    exit 1
  fi
fi
HERMES_ROOT="${HERMES_ROOT%/}"
[ -f "$HERMES_ROOT/config.yaml" ] || { echo "$HERMES_ROOT/config.yaml tidak ada. Pastikan HERMES_ROOT menunjuk ke folder Hermes."; exit 1; }
echo "Hermes: $HERMES_ROOT"
if [ ! -w "$HERMES_ROOT" ]; then
  echo "User $(whoami) tidak bisa menulis ke $HERMES_ROOT (pemilik: $(stat -c %U "$HERMES_ROOT" 2>/dev/null || echo '?'))."
  echo "Jalankan sebagai pemilik folder itu, mis.: sudo -u $(stat -c %U "$HERMES_ROOT" 2>/dev/null || echo www-data) HERMES_ROOT=$HERMES_ROOT bash $0"
  exit 1
fi

# 1. Node.js: pakai yang ada, kalau tidak ada unduh ke ~/.local/node (tanpa root)
say "Mencari Node.js"
NODE=""
for c in "$(command -v node 2>/dev/null || true)" "$HERMES_ROOT/node/bin/node" "$HOME/.local/node/bin/node"; do
  if [ -n "$c" ] && [ -x "$c" ] && [ "$("$c" -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Arsitektur $(uname -m) tidak didukung"; exit 1 ;; esac
  TARBALL="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk -v a="-linux-$ARCH.tar.xz" 'substr($2, length($2)-length(a)+1) == a && !f { print $2; f = 1 }')"
  echo "Mengunduh $TARBALL ..."
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$TARBALL" | tar -xJ -C "$HOME/.local/node" --strip-components=1
  NODE="$HOME/.local/node/bin/node"
fi
echo "Node: $NODE ($("$NODE" -v))"

# 2. Token & password (dibuat sekali, disimpan di ~/.astacode-office.env)
say "Menyiapkan token & password"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
OFFICE_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
OFFICE_PASSWORD=$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)
EOF
fi
# Simpan lokasi Hermes, port & alamat dengar (menimpa nilai lama).
{ grep -v '^HERMES_ROOT=\|^HOST=\|^PORT=' "$ENV_FILE" || true; printf 'HERMES_ROOT=%s\nHOST=%s\nPORT=%s\n' "$HERMES_ROOT" "$HOST" "$PORT"; } > "$ENV_FILE.tmp" && cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
if [ -n "$SET_USER" ]; then
  { grep -v '^OFFICE_USER=' "$ENV_FILE" || true; printf 'OFFICE_USER=%q\n' "$SET_USER"; } > "$ENV_FILE.tmp" && cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
fi
if [ -n "$SET_PASS" ]; then
  { grep -v '^OFFICE_PASSWORD=' "$ENV_FILE" || true; printf 'OFFICE_PASSWORD=%q\n' "$SET_PASS"; } > "$ENV_FILE.tmp" && cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
fi
set -a; . "$ENV_FILE"; set +a

# 3. Jalankan server + otomatis hidup lagi setelah VPS reboot (crontab user)
say "Menjalankan server kantor di port $PORT"
RUN="cd '$APP_DIR' && set -a && . '$ENV_FILE' && set +a && nohup '$NODE' tools/mock-hermes.js >> '$LOG_FILE' 2>&1 < /dev/null &"
pkill -u "$(id -u)" -f "tools/mock-hermes.js" 2>/dev/null || true
sleep 1
if command -v ss >/dev/null && ss -ltn | awk '{print $4}' | grep -qE "[:.]$PORT\$"; then
  echo "Port $PORT sudah dipakai aplikasi lain. Pilih port lain, mis.: PORT=8788 bash $0"; exit 1
fi
bash -c "$RUN" < /dev/null > /dev/null 2>&1
if command -v crontab >/dev/null; then
  ( crontab -l 2>/dev/null | grep -v 'tools/mock-hermes.js' || true; echo "@reboot $RUN" ) | crontab - \
    || echo "crontab user $(whoami) tidak diizinkan: setelah VPS reboot, jalankan ulang script ini."
else
  echo "crontab tidak ada: setelah VPS reboot, jalankan ulang script ini."
fi
sleep 1
curl -fsS -o /dev/null -u "${OFFICE_USER:-x}:$OFFICE_PASSWORD" "http://127.0.0.1:$PORT/office/" && echo "Server OK" || { echo "Server gagal jalan, lihat $LOG_FILE"; exit 1; }

# 3b. Audit situs & kompetitor: folder data + config bawaan (config yang sudah ada tidak ditimpa)
mkdir -p "$APP_DIR/data/audit" "$APP_DIR/config"
if [ ! -f "$APP_DIR/config/seo-audit.json" ]; then
  printf '%s\n' '{' '  "site": "https://astacode.id",' '  "maxPages": 300,' '  "competitors": [],' '  "psi": { "enabled": true, "strategies": ["mobile", "desktop"], "maxUrls": 6, "competitors": true }' '}' > "$APP_DIR/config/seo-audit.json"
  echo "Config audit dibuat: $APP_DIR/config/seo-audit.json (isi daftar kompetitor di sana)"
fi
grep -q '^PSI_API_KEY=.' "$ENV_FILE" 2>/dev/null && echo "PSI_API_KEY: terpasang (Core Web Vitals aktif)" || echo "PSI_API_KEY: belum diisi (Core Web Vitals nonaktif sampai kunci dipasang)"

# 4. Pasang hook ke setiap profile Hermes + isi OFFICE_TOKEN di .env profile
say "Memasang hook ke profile Hermes"
for home in "$HERMES_ROOT" "$HERMES_ROOT"/profiles/*/; do
  home="${home%/}"
  [ -d "$home" ] || continue
  [ "$home" = "$HERMES_ROOT" ] || [ -f "$home/config.yaml" ] || continue
  mkdir -p "$home/hooks"
  rm -rf "$home/hooks/astacode_office"
  cp -r "$APP_DIR/tools/hermes-hook/astacode_office" "$home/hooks/"
  touch "$home/.env"
  grep -v '^OFFICE_TOKEN=\|^OFFICE_URL=' "$home/.env" > "$home/.env.tmp" || true
  printf 'OFFICE_TOKEN=%s\nOFFICE_URL=http://127.0.0.1:%s/api/office/events\n' "$OFFICE_TOKEN" "$PORT" >> "$home/.env.tmp"
  cat "$home/.env.tmp" > "$home/.env" && rm -f "$home/.env.tmp"
  # Skill tim-kantor mengubah perilaku agent, jadi HANYA dipasang bila diminta: INSTALL_SKILL=1 bash ...
  if [ "${INSTALL_SKILL:-0}" = "1" ]; then
    name="default"; [ "$home" = "$HERMES_ROOT" ] || name="$(basename "$home")"
    mkdir -p "$home/skills/tim-kantor"
    sed "s/{{PROFILE}}/$name/g" "$APP_DIR/tools/hermes-skill/tim-kantor/SKILL.md" > "$home/skills/tim-kantor/SKILL.md"
    echo "  ok: $home (hook + skill tim-kantor)"
  else
    echo "  ok: $home (hook)"
  fi
done

# 5. Restart gateway yang sedang jalan supaya hook terbaca
say "Restart gateway Hermes yang aktif"
UNITS="$(systemctl list-unit-files 'hermes-agent*' --no-legend 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
if [ -n "$UNITS" ]; then
  # Gateway dijalankan systemd (service ber-sandbox): restart hanya bisa oleh root.
  echo "Gateway berjalan sebagai service systemd. Restart sebagai ROOT supaya hook terbaca:"
  echo "  systemctl restart $UNITS"
  echo "Lalu cek: journalctl -u hermes-agent --since '2 min ago' --no-pager | grep -i hook"
fi
HERMES_BIN="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
[ -n "$UNITS" ] || for home in "$HERMES_ROOT" "$HERMES_ROOT"/profiles/*/; do
  home="${home%/}"
  grep -q '"gateway_state": *"running"' "$home/gateway_state.json" 2>/dev/null || continue
  name="default"; [ "$home" = "$HERMES_ROOT" ] || name="$(basename "$home")"
  echo "  restart: $name"
  HERMES_HOME="$HERMES_ROOT" "$HERMES_BIN" -p "$name" gateway restart || echo "  (gagal restart $name, restart manual: HERMES_HOME=$HERMES_ROOT hermes -p $name gateway restart)"
done

IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
say "Selesai"
if [ "$HOST" = "127.0.0.1" ]; then
  echo "Server hanya bisa dibuka dari dalam VPS. Dari laptop, buka SSH tunnel (biarkan terminalnya terbuka):"
  echo "  ssh -L $PORT:127.0.0.1:$PORT USER_SSH_ANDA@$IP"
  echo "lalu buka http://localhost:$PORT/office/"
else
  echo "Buka di browser : http://$IP:$PORT/office/  (pastikan port $PORT dibuka di firewall)"
fi
cat <<EOF
Username        : ${OFFICE_USER:-bebas (mis. ceo)}
Password        : $OFFICE_PASSWORD
Log server      : $LOG_FILE
Pengaturan      : $ENV_FILE
EOF
