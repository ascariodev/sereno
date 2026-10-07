<?php

use App\Broadcasting\ChannelChannel;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('organizations.{organization}.channels.{channel}', ChannelChannel::class);
