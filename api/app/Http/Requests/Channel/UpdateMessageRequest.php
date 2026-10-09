<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use App\Models\Message;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class UpdateMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var Channel $channel */
        $channel = $this->route('channel');
        /** @var Message $message */
        $message = $this->route('message');

        abort_unless($message->channel_id === $channel->id, 404);

        return Gate::allows('update', $message);
    }

    public function rules(): array
    {
        /** @var Message $message */
        $message = $this->route('message');

        // Attachments are not edited: a message without text must keep at least one.
        $required = $message->attachments()->exists() ? 'nullable' : 'required';

        return [
            'body' => [$required, 'nullable', 'string', 'max:'.StoreMessageRequest::MAX_BODY_LENGTH, 'not_regex:/\x00/'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($this->route('channel')->archived_at !== null) {
                    $validator->errors()->add('channel', __('The channel is archived.'));
                }
            },
        ];
    }
}
