<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use App\Models\Message;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class DeleteMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var Channel $channel */
        $channel = $this->route('channel');
        /** @var Message $message */
        $message = $this->route('message');

        abort_unless($message->channel_id === $channel->id, 404);

        return Gate::allows('delete', $message);
    }

    public function rules(): array
    {
        return [];
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
