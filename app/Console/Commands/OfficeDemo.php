<?php

namespace App\Console\Commands;

use App\Services\VirtualOffice;
use Illuminate\Console\Command;

class OfficeDemo extends Command
{
    protected $signature = 'office:demo {agent=seo_specialist} {message=Tolong riset 10 keyword untuk halaman jasa IT consultant.}';

    protected $description = 'Kirim satu alur DM -> kerja -> laporan ke kantor virtual untuk uji coba';

    public function handle(): int
    {
        $agent = $this->argument('agent');

        VirtualOffice::dm($agent, $this->argument('message'));
        $this->info('DM terkirim. Lihat kantor virtual.');
        sleep(8);

        VirtualOffice::work($agent, 'Mengerjakan permintaan CEO', 60, 'Sudah 60 persen.');
        $this->info('Progres terkirim.');
        sleep(8);

        VirtualOffice::report($agent, 'Tugas selesai. Hasil sudah saya kirim lewat Telegram.');
        $this->info('Laporan terkirim.');

        return self::SUCCESS;
    }
}
