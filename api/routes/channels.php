<?php

use App\Broadcasting\ChannelChannel;
use App\Broadcasting\OrganizationMembersChannel;
use App\Broadcasting\ProjectChannel;
use App\Broadcasting\SessionChannel;
use App\Broadcasting\UserChannel;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('organizations.{organization}.channels.{channel}', ChannelChannel::class);
Broadcast::channel('users.{userId}', UserChannel::class);
Broadcast::channel('sessions.{userId}', SessionChannel::class);
Broadcast::channel('organizations.{organization}.projects.{project}', ProjectChannel::class);
Broadcast::channel('organizations.{organization}.members', OrganizationMembersChannel::class);
