<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class StoreMessageRequest extends FormRequest
{
    public const MAX_BODY_LENGTH = 4000;

    public function authorize(): bool
    {
        return Gate::allows('view', $this->route('channel'));
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:'.self::MAX_BODY_LENGTH, 'not_regex:/\x00/'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                /** @var Channel $channel */
                $channel = $this->route('channel');

                if ($channel->archived_at !== null) {
                    $validator->errors()->add('channel', __('The channel is archived.'));
                }
            },
        ];
    }
}
