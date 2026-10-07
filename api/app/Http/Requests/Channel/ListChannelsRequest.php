<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class ListChannelsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('viewAny', Channel::class);
    }

    public function rules(): array
    {
        return [];
    }
}
