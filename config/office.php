<?php

return [
    // Token opsional untuk POST /api/office/events (dari luar Laravel). Kosong = tanpa token.
    'token' => env('OFFICE_TOKEN'),

    // Siapa yang dianggap pemberi tugas saat Anda mengirim DM.
    'owner' => 'ceo',

    // Peta: nama/slug/ID agent di Hermes  =>  id karakter di kantor virtual.
    // Ganti sisi KIRI sesuai identitas agent di Hermes Anda.
    'agents' => [
        'orchestrator'      => 'orchestrator',
        'seo'               => 'seo_specialist',
        'marketing'         => 'marketing_leader',
        'software-engineer' => 'software_engineer',
        'social-media'      => 'social_media',
        'qa'                => 'qa_testing',
        'project-manager'   => 'project_manager',
        'blog-writer'       => 'blog_writer',
        'designer'          => 'uiux_designer',
        'ceo'               => 'ceo',
        'coo'               => 'coo',
        'cfo'               => 'cfo',
        'irfan'             => 'irfan',
        'pram'              => 'pram',
        'dita'              => 'dita',
    ],
];
