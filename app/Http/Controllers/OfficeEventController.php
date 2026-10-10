<?php

namespace App\Http\Controllers;

use App\Models\OfficeEvent;
use App\Services\VirtualOffice;
use Illuminate\Http\Request;

class OfficeEventController extends Controller
{
    /** Dipanggil halaman kantor tiap detik: GET /api/office/events?after={id} */
    public function index(Request $request)
    {
        $last = (int) OfficeEvent::max('id');
        $after = $request->query('after');

        // Panggilan pertama (after kosong): jangan putar ulang riwayat, cukup beri posisi terakhir.
        if ($after === null || $after === '' || (int) $after > $last) {
            return response()->json(['events' => [], 'last_id' => $last]);
        }

        $rows = OfficeEvent::where('id', '>', (int) $after)->orderBy('id')->limit(100)->get();

        return response()->json([
            'events' => $rows->map(fn ($e) => array_merge($e->payload, [
                'id' => $e->id,
                'timestamp' => $e->created_at->toIso8601String(),
            ]))->values(),
            'last_id' => $rows->isEmpty() ? $last : $rows->last()->id,
        ]);
    }

    /** Opsional, untuk mengirim event dari luar Laravel atau menguji dengan curl. */
    public function store(Request $request)
    {
        $token = config('office.token');
        abort_if($token && ! hash_equals($token, (string) $request->header('X-Office-Token')), 403);

        $data = $request->validate([
            'type' => 'required|in:dm,work,talk,report,idle',
            'agent' => 'required|string',
            'from' => 'nullable|string',
            'to' => 'nullable|string',
            'target' => 'nullable|string',
            'message' => 'nullable|string|max:2000',
            'task' => 'nullable|string|max:200',
            'task_id' => 'nullable|string|max:64',
            'progress' => 'nullable|integer|min:0|max:100',
        ]);

        foreach (['agent', 'from', 'to', 'target'] as $key) {
            if (! empty($data[$key])) {
                $data[$key] = VirtualOffice::id($data[$key]);
            }
        }

        VirtualOffice::push($data);

        return response()->json(['ok' => true]);
    }
}
