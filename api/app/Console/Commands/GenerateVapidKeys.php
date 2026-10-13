<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Minishlink\WebPush\VAPID;

#[Signature('push:vapid-keys')]
#[Description('Generate a VAPID key pair for Web Push and print it without writing the .env')]
class GenerateVapidKeys extends Command
{
    public function handle(): int
    {
        $keys = VAPID::createVapidKeys();

        $this->components->info(__('VAPID key pair generated. Add these lines to the API .env and keep the private key secret.'));
        $this->line('VAPID_PUBLIC_KEY='.$keys['publicKey']);
        $this->line('VAPID_PRIVATE_KEY='.$keys['privateKey']);

        return self::SUCCESS;
    }
}
