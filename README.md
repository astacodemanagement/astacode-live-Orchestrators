# Astacode Agent Office + Hermes (lokal)

Kantor virtual 3D yang diam secara default. Saat Anda mengirim DM ke salah satu agent di Hermes:

1. Pesan DM muncul di atas kepala agent itu dengan logo Telegram.
2. Agent membaca, lalu bekerja di mejanya (atau mendatangi agent lain bila Hermes mengirim event `talk`).
3. Setelah selesai, agent berjalan ke meja CEO dan menyampaikan laporannya.

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

## Catatan

- Halaman membaca event dengan polling tiap 1 detik ke `GET /api/office/events`, jadi tidak butuh Reverb, Pusher, atau Redis.
- Jika kantor dan API beda origin (mis. Vite di port 5173), buka kantor lewat Laravel (`/office/index.html`) atau pakai komponen React di atas supaya tidak terkena CORS.
- `POST /api/office/events` terbuka secara default untuk pengujian lokal. Sebelum dipasang di server publik, isi `OFFICE_TOKEN` di `.env` dan kirim header `X-Office-Token`.
- Kode Laravel di paket ini belum dijalankan di proyek Hermes Anda; halaman kantor dan alur event-nya sudah diuji dengan `tools/mock-hermes.js`.
