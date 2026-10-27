# Astacode Agent Office + Hermes (lokal)

Kantor virtual 3D yang diam secara default. Setiap profile Hermes di VPS tampil sebagai satu karakter (Anda sebagai CEO). Saat Anda mengirim DM Telegram ke salah satu profile:

1. Pesan DM muncul di atas kepala agent itu dengan logo Telegram.
2. Agent membaca, lalu bekerja di mejanya. Tool yang sedang dipakai (mis. `web_search`, `terminal`) muncul sebagai gelembung.
3. Setelah membalas, agent berjalan ke meja CEO dan menyampaikan balasannya.

Profile baru yang dibuat di Hermes otomatis mendapat meja (dicek tiap 30 detik, atau saat profile itu pertama kali menerima DM).

## Isi paket

| File | Fungsi |
|---|---|
| `public/office/` | Halaman kantor 3D (three.js sudah disertakan, tidak perlu CDN) |
| `app/Services/VirtualOffice.php` | Satu kelas untuk mengirim kejadian dari Hermes |
| `app/Models/OfficeEvent.php`, `database/migrations/...` | Tabel antrean event |
| `app/Http/Controllers/OfficeEventController.php`, `routes/office.php` | API yang dibaca halaman kantor |
| `config/office.php` | Peta nama agent Hermes ke karakter kantor |
| `app/Console/Commands/OfficeDemo.php` | Perintah uji `php artisan office:demo` |
| `resources/js/components/VirtualOffice.jsx` | Komponen React (iframe) |
| `tools/mock-hermes.js` | Server uji tanpa Laravel |

## Coba dulu tanpa Laravel (1 menit)

```bash
node tools/mock-hermes.js
# buka http://localhost:8787/office/
curl -X POST localhost:8787/api/office/events -H "Content-Type: application/json" \
  -d '{"type":"dm","agent":"seo_specialist","message":"Riset 10 keyword jasa IT consultant"}'
curl -X POST localhost:8787/api/office/events -H "Content-Type: application/json" \
  -d '{"type":"report","agent":"seo_specialist","message":"Selesai, 10 keyword terkirim."}'
```

## Sambungkan ke Hermes Agent (profile Telegram) di VPS

Tanpa Laravel. Hook `tools/hermes-hook/astacode_office` mengirim `dm` saat pesan Telegram Anda masuk ke sebuah profile, dan `report` berisi balasan agent saat selesai.

1. Salin folder paket ini ke VPS, mis. `/opt/astacode-office`, lalu jalankan servernya (perlu Node 18+):

   ```bash
   cd /opt/astacode-office
   OFFICE_TOKEN=ganti-token OFFICE_PASSWORD=ganti-password node tools/mock-hermes.js
   ```

   Agar tetap jalan setelah logout: `pm2 start tools/mock-hermes.js --name office` (env yang sama), atau unit systemd.

2. Pasang hook ke setiap profile Hermes:

   ```bash
   for home in ~/.hermes ~/.hermes/profiles/*/; do
     mkdir -p "$home/hooks" && cp -r /opt/astacode-office/tools/hermes-hook/astacode_office "$home/hooks/"
     grep -q '^OFFICE_TOKEN=' "$home/.env" 2>/dev/null || echo 'OFFICE_TOKEN=ganti-token' >> "$home/.env"
   done
   ```

3. Restart gateway Hermes untuk tiap profile yang aktif. Di log harus muncul `[hooks] Loaded hook 'astacode_office'`.
4. Buka `http://IP-VPS:8787/office/` dan login dengan password tadi (username bebas). Buka port 8787 di firewall, atau taruh di belakang Nginx + HTTPS.
5. Kirim DM ke salah satu bot di Telegram. Pesan Anda muncul di atas kepala agent, agent bekerja, lalu berjalan ke meja CEO dan menyampaikan balasannya.

Hermes tidak harus di `~/.hermes`. Installer mencarinya otomatis di `/var/www`, `/opt`, `/srv`, `/home`, dan `/root`; kalau tidak ketemu atau ada lebih dari satu, sebutkan langsung: `HERMES_ROOT=/var/www/hermes bash tools/install-vps.sh`. Jalankan installer sebagai user pemilik folder Hermes (mis. `sudo -u www-data ...`) supaya hook bisa disalin.

Karakter dibuat dari folder profile di `HERMES_ROOT` (default `~/.hermes`): `~/.hermes` menjadi karakter `Hermes` di meja pusat, dan `~/.hermes/profiles/<nama>` menjadi karakter `<nama>`. Nama tampilan dan jabatan bisa diatur dengan menyalin `config/agents.example.json` ke `config/agents.json` (kunci = nama profile, `"hide": true` untuk menyembunyikan). Server membaca file itu setiap kali halaman mengambil daftar agent, jadi tidak perlu restart. Untuk menggabungkan sebuah profile ke karakter lain, isi `OFFICE_AGENT=...` di `.env` profile itu. Hanya pesan Telegram yang diteruskan; isi `OFFICE_PLATFORMS=*` untuk semua platform. Event tersimpan di memori (500 terakhir) dan hilang saat server restart.

## Delegasi antar agent (tim kantor)

Installer memasang skill `tim-kantor` ke setiap profile. Agent bisa memberi tugas ke rekan:

```bash
python3 ~/astacode-office/tools/delegate.py --list
python3 ~/astacode-office/tools/delegate.py --from galih --to seo --task "Riset 10 keyword jasa IT consultant"
```

Tanpa skrip pun, server kantor mengamati proses `hermes -p <rekan> -z "..."` milik user agent (`tools/office-watch.js`, hanya membaca `/proc`, matikan dengan `OFFICE_WATCH=0`), jadi delegasi cara lama (mis. cron `astacode-workflow`) ikut tampil; gelembung hasilnya generik karena isi jawaban tidak terbaca dari luar proses.

Skrip ini menjalankan rekan sungguhan (`hermes -p <rekan> -z`, tidak butuh gateway/bot milik rekan) dan menggerakkan kantor: pemberi tugas berjalan ke meja rekan sambil berkata "Tolong kerjain tugas dari ...", rekan menerima tugas saat didatangi, bekerja, lalu berjalan kembali membawa hasil. Hasil lengkap dicetak ke stdout untuk agent pemberi tugas, yang kemudian melapor ke CEO lewat Telegram. Nama panggilan pemilik diatur dengan `"ceo": {"call": "Mas Galih"}` di `config/agents.json`. Delegasi berantai dibatasi 2 tingkat.

Agent tanpa tugas bisa santai (ngopi, tenis meja, main PS, nonton TV); tombol **Santai** di bar atas mematikannya.

## Performa Web: Search Console, Audit Situs, Core Web Vitals, Kompetitor

Klik layar dashboard di ruang meeting (atau tombol **Performa Web**) untuk membuka popup dengan tujuh tab:

| Tab | Sumber data |
|---|---|
| Ringkasan, Keyword, Halaman, Peluang | CSV Search Console dari skrip `~/seo` (filter periode 7 hari / 28 hari / custom; 3 bulan terbuka saat riwayat cukup) |
| **Audit Situs** | `tools/seo-audit.js`: crawler 40+ pengecekan (status, redirect, canonical, sitemap, robots, judul/meta/H1, duplikat, tautan rusak, HTTPS, mixed content, schema, kecepatan server, dll), skor kesehatan, tren, dan perbandingan antar crawl |
| Skor di tab Audit | **Site Health**, **Skor SEO**, **AI Search Health** (7 komponen heuristik: akses crawler AI, schema, struktur konten, entitas/E-E-A-T, kesegaran, llms.txt, keterbacaan tanpa JavaScript), **Kecepatan Mobile** dan **Desktop** |
| Core Web Vitals (di tab Audit) | PageSpeed Insights API (butuh `PSI_API_KEY`, gratis), mobile dan desktop |
| **Kompetitor** | Data publik: sitemap, sampel halaman, robots.txt, teknologi, PageSpeed. Papan peringkat gabungan, celah (di mana Anda tertinggal), keunggulan, celah topik konten, perbandingan AI Search, halaman baru, perubahan judul/meta/H1. Dianalisis bersamaan dengan audit situs |
| **Rencana Perbaikan** | Rekomendasi berprioritas dari audit + analisis kompetitor, bisa **didelegasikan** ke agent Hermes yang jabatannya paling cocok (saran dinamis dari jabatan agent di tim; Anda konfirmasi dulu) |

**Kompetitor lewat agent SEO:** tombol **Minta agent mencari kompetitor** (tab Kompetitor) menugaskan agent Hermes Anda (disarankan agent SEO) menentukan sendiri layanan, keyword, dan pesaing relevan memakai skill riset yang sudah terpasang. Jawabannya (JSON) divalidasi ketat dan jadi daftar kandidat; Anda memutuskan lewat **Pantau** atau **Abaikan**. Bila daftar `competitors` di config kosong, 3 kandidat teratas dianalisis otomatis dalam audit. Tidak butuh kunci pencarian tambahan (memakai kuota model AI Hermes Anda).

**Delegasi dari dashboard:** tombol Delegasikan memanggil `tools/delegate.py` lewat `tools/delegate-job.js`. Teks tugas dibuat server dari data audit situs Anda sendiri (bukan dari isi halaman web), memuat aturan agar agent mengikuti izin profilnya dan tidak mengubah aturan/skill/memori Hermes. Maks 3 tugas berjalan bersamaan.

Konfigurasi di `config/seo-audit.json` (lihat `config/seo-audit.example.json`). Hasil di `data/audit/`.

```bash
node tools/seo-audit.js --kind all          # site | competitors | all   (--quick untuk uji cepat)
```

Perayapan patuh `robots.txt`, dibatasi kecepatannya (bawaan 3 permintaan/detik, prioritas CPU rendah), memakai User-Agent `AstacodeAuditBot`, dan hanya membuka halaman publik. Alamat privat (localhost/10.x/192.168.x) tidak diperiksa sebagai tautan eksternal. Volume keyword, backlink, dan trafik kompetitor tidak tersedia karena itu data berbayar. Skor kesehatan memakai rumus sendiri yang transparan (lihat di popup), jadi tidak sama dengan skor Semrush; trennya yang bisa dipercaya.

Jadwal malam (opsional, jalankan sebagai user agent):

```bash
( crontab -l 2>/dev/null | grep -v 'seo-audit.js'; echo "0 20 * * * cd $HOME/astacode-office && set -a && . $HOME/.astacode-office.env && set +a && $HOME/.local/node/bin/node tools/seo-audit.js --kind all >> $HOME/.astacode-office-audit.log 2>&1" ) | crontab -
```

## Pasang di proyek Hermes (Laravel)

1. Salin folder `app/`, `config/`, `database/`, `public/`, `resources/` ke proyek Laravel Anda (menambah file, tidak menimpa yang ada).
2. Tempel dua baris route dari `routes/office.php` ke `routes/api.php`. Di Laravel 11 ke atas, jika `routes/api.php` belum ada, jalankan `php artisan install:api`.
3. Jalankan `php artisan migrate`.
4. Buka `http://localhost:8000/office/index.html`. Indikator di kanan atas harus bertuliskan "Terhubung ke Hermes".
5. Uji: `php artisan office:demo seo_specialist`.

Di React: `import VirtualOffice from "./components/VirtualOffice"` lalu `<VirtualOffice />`.

## Sambungkan ke alur Hermes Anda

Panggil `VirtualOffice` di tiga titik kode Hermes. Hanya `dm` dan `report` yang wajib.

```php
use App\Services\VirtualOffice;

// 1. Saat DM Telegram masuk untuk sebuah agent (mis. di handler webhook Telegram)
VirtualOffice::dm($agent->slug, $message->text);

// 2. Opsional, saat agent sedang berproses
VirtualOffice::work($agent->slug, 'Riset keyword', 40);
VirtualOffice::talk($agent->slug, 'blog-writer', 'Ini daftar keywordnya');   // mendatangi agent lain

// 3. Saat agent mengirim balasan/hasil ke Telegram
VirtualOffice::report($agent->slug, $replyText);
```

`$agent->slug` hanyalah contoh. Pakai pengenal agent apa pun yang ada di Hermes Anda, lalu daftarkan di `config/office.php` (sisi kiri = nama di Hermes, sisi kanan = karakter kantor).

Id karakter kantor: `ceo`, `coo`, `cfo`, `orchestrator`, `seo_specialist`, `blog_writer`, `social_media`, `marketing_leader`, `uiux_designer`, `project_manager`, `software_engineer`, `qa_testing`, `irfan`, `pram`, `dita`.

## Skema event

| type | field | Yang terjadi di kantor |
|---|---|---|
| `dm` | `agent`, `message`, `from` (default `ceo`) | Gelembung Telegram di atas kepala agent, lalu agent mulai bekerja |
| `work` | `agent`, `task`, `progress`, `message` | Agent mengetik di meja, progres diperbarui |
| `talk` | `agent`, `target`, `message` | Agent berjalan ke meja `target` dan berbicara |
| `report` | `agent`, `message`, `to` (default pengirim DM) | Agent berjalan ke pemberi tugas dan melapor |
| `idle` | `agent` | Agent kembali diam |

`GET /api/office/agents` mengembalikan daftar karakter: `{"owner":{"id":"ceo",...},"agents":[{"id":"seo","name":...,"role":...}]}`. Backend Laravel belum menyediakan endpoint ini, jadi di sana halaman memakai daftar karakter demo bawaan.

## Catatan

- Halaman membaca event dengan polling tiap 1 detik ke `GET /api/office/events`, jadi tidak butuh Reverb, Pusher, atau Redis.
- Jika kantor dan API beda origin (mis. Vite di port 5173), buka kantor lewat Laravel (`/office/index.html`) atau pakai komponen React di atas supaya tidak terkena CORS.
- `POST /api/office/events` terbuka secara default untuk pengujian lokal. Sebelum dipasang di server publik, isi `OFFICE_TOKEN` di `.env` dan kirim header `X-Office-Token`.
- Kode Laravel di paket ini belum dijalankan di proyek Hermes Anda; halaman kantor dan alur event-nya sudah diuji dengan `tools/mock-hermes.js`.
