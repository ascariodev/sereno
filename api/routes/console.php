<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('log:maintain')->dailyAt('00:10')->timezone('UTC')->withoutOverlapping();

Schedule::command('queue:prune-failed', ['--hours' => 168])->dailyAt('00:20')->timezone('UTC');
