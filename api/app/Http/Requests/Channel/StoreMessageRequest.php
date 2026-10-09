<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use App\Models\Message;
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
            'parent_id' => ['nullable', 'integer', 'min:1'],
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

                if ($validator->errors()->has('parent_id') || $this->input('parent_id') === null) {
                    return;
                }

                // The organization scope hides roots of other organizations.
                $parent = Message::query()->find($this->integer('parent_id'));

                if ($parent === null || $parent->channel_id !== $channel->id) {
                    $validator->errors()->add('parent_id', __('The message to reply to does not exist in this channel.'));
                } elseif ($parent->parent_id !== null) {
                    $validator->errors()->add('parent_id', __('A reply cannot have replies.'));
                }
            },
        ];
    }
}
