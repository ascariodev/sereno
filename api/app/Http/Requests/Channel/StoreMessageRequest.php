<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
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
            'body' => ['required_without:attachment_ids', 'nullable', 'string', 'max:'.self::MAX_BODY_LENGTH, 'not_regex:/\x00/'],
            'parent_id' => ['nullable', 'integer', 'min:1'],
            'attachment_ids' => ['nullable', 'list', 'max:'.config('chat.attachments.max_per_message')],
            'attachment_ids.*' => ['integer', 'min:1', 'distinct'],
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

                $this->checkAttachments($validator, $channel);

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

    /** @return list<int> */
    public function attachmentIds(): array
    {
        return array_map('intval', $this->validated('attachment_ids') ?? []);
    }

    /**
     * Ids of another user, channel or organization and ids already in use give the same error,
     * so the response does not reveal which attachments exist.
     */
    private function checkAttachments(Validator $validator, Channel $channel): void
    {
        $ids = $this->input('attachment_ids');

        if (! is_array($ids) || $ids === [] || $validator->errors()->has('attachment_ids*')) {
            return;
        }

        $ids = array_map('intval', $ids);

        // The organization scope hides attachments of other organizations.
        $available = MessageAttachment::query()
            ->whereIn('id', $ids)
            ->where('channel_id', $channel->id)
            ->where('uploaded_by', $this->user()->id)
            ->whereNull('message_id')
            ->count();

        if ($available !== count($ids)) {
            $validator->errors()->add('attachment_ids', __('The attachments do not exist or are already in use.'));
        }
    }
}
