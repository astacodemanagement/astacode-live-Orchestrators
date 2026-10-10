<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OfficeEvent extends Model
{
    protected $fillable = ['payload'];

    protected $casts = ['payload' => 'array'];
}
