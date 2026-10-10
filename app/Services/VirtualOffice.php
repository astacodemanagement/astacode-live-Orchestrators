<?php

namespace App\Services;

use App\Models\OfficeEvent;

/**
 * Kirim kejadian dari Hermes ke kantor virtual.
 *
 *   VirtualOffice::dm('seo', 'Riset 10 keyword');          // DM Telegram masuk
 *   VirtualOffice::work('seo', 'Riset keyword', 40);       // opsional: progres
 *   VirtualOffice::talk('seo', 'blog-writer', 'Ini keywordnya'); // opsional: mendatangi agent lain
 *   VirtualOffice::report('seo', 'Selesai, 10 keyword terlampir'); // melapor ke CEO
 */
class VirtualOffice
{
    public static function dm(string $agent, string $message, ?string $from = null, ?string $taskId = null): void
    {
        self::push(['type' => 'dm', 'agent' => self::id($agent), 'from' => self::id($from ?? config('office.owner', 'ceo')), 'message' => $message, 'task_id' => $taskId]);
    }

    public static function work(string $agent, string $task, ?int $progress = null, ?string $message = null): void
    {
        self::push(['type' => 'work', 'agent' => self::id($agent), 'task' => $task, 'progress' => $progress, 'message' => $message]);
    }

    public static function talk(string $agent, string $target, ?string $message = null): void
    {
        self::push(['type' => 'talk', 'agent' => self::id($agent), 'target' => self::id($target), 'message' => $message]);
    }

    public static function report(string $agent, string $message, ?string $to = null, ?string $taskId = null): void
    {
        self::push(['type' => 'report', 'agent' => self::id($agent), 'to' => $to ? self::id($to) : null, 'message' => $message, 'task_id' => $taskId]);
    }

    public static function idle(string $agent): void
    {
        self::push(['type' => 'idle', 'agent' => self::id($agent)]);
    }

    /** Ubah nama agent di Hermes menjadi id karakter kantor (lihat config/office.php). */
    public static function id(string $agent): string
    {
        $key = strtolower(trim($agent));

        return config("office.agents.$key", $key);
    }

    public static function push(array $payload): void
    {
        try {
            OfficeEvent::create(['payload' => array_filter($payload, fn ($v) => $v !== null)]);

            // Bersihkan event lama sesekali supaya tabel tidak membengkak.
            if (random_int(1, 50) === 1) {
                OfficeEvent::where('created_at', '<', now()->subDay())->delete();
            }
        } catch (\Throwable $e) {
            // Kantor virtual tidak boleh mengganggu alur utama Hermes.
            report($e);
        }
    }
}
