<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class StoreAttachmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('view', $this->route('channel'));
    }

    public function rules(): array
    {
        return [
            'file' => [
                'required',
                'file',
                'max:'.config('chat.attachments.max_size_kb'),
                function (string $attribute, mixed $value, Closure $fail) {
                    if ($value instanceof UploadedFile && $value->getSize() === 0) {
                        $fail(__('The file is empty.'));
                    }
                },
            ],
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
