<?php

use App\Broadcasting\ChannelChannel;
use App\Broadcasting\UserChannel;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('organizations.{organization}.channels.{channel}', ChannelChannel::class);
Broadcast::channel('users.{userId}', UserChannel::class);
