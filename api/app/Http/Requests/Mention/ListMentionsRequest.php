<?php

namespace App\Http\Requests\Mention;

use App\Http\Requests\Channel\ListMessagesRequest;
use App\Models\Channel;
use Illuminate\Support\Facades\Gate;

class ListMentionsRequest extends ListMessagesRequest
{
    public function authorize(): bool
    {
        return Gate::allows('viewAny', Channel::class);
    }
}
