<?php

// Tempel dua baris ini ke routes/api.php (hasilnya /api/office/events).
// Laravel 11 ke atas: jika routes/api.php belum ada, jalankan dulu `php artisan install:api`.

use App\Http\Controllers\OfficeEventController;
use Illuminate\Support\Facades\Route;

Route::get('/office/events', [OfficeEventController::class, 'index']);
Route::post('/office/events', [OfficeEventController::class, 'store']);
