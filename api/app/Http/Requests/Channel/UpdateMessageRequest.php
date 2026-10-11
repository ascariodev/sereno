<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use App\Models\Message;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
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

        return Gate::authorize('update', $message)->allowed();
    }

    public function rules(): array
    {
        /** @var Message $message */
        $message = $this->route('message');

        $removing = collect($this->input('remove_attachment_ids'))->filter(fn ($id) => is_int($id))->all();

        // A message without text must keep at least one attachment.
        $required = $message->attachments()->whereNotIn('id', $removing)->exists() ? 'nullable' : 'required';

        return [
            'remove_attachment_ids' => ['sometimes', 'array', 'max:'.config('chat.attachments.max_per_message')],
            'remove_attachment_ids.*' => ['integer', 'distinct', Rule::exists('message_attachments', 'id')->where('message_id', $message->id)],
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
