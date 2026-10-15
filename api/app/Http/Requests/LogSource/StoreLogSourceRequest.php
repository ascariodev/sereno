<?php

namespace App\Http\Requests\LogSource;

use App\Enums\LogSourceKind;
use App\Models\LogSource;
use App\Models\Project;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreLogSourceRequest extends FormRequest
{
    public const MAX_ALLOWED_ORIGINS = 20;

    /**
     * An exact browser origin: https with any host, or plain http only for localhost and 127.0.0.1.
     * No path, query, fragment, credentials or trailing slash; the port is optional.
     */
    private const ORIGIN_PATTERN = '~\A(?:https://(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|http://(?:localhost|127\.0\.0\.1))(?::(?<port>[1-9][0-9]{0,4}))?\z~';

    /** Runs before the rules so unauthorized users get 403 and never a 422 about the project state. */
    public function authorize(): bool
    {
        return Gate::allows('create', LogSource::class);
    }

    protected function prepareForValidation(): void
    {
        $origins = $this->input('allowed_origins');

        if (! is_array($origins) || ! array_is_list($origins)) {
            return;
        }

        $normalized = array_map(fn ($origin) => is_string($origin) ? static::normalizeOrigin($origin) : $origin, $origins);

        $this->merge(['allowed_origins' => array_values(array_unique($normalized, SORT_REGULAR))]);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'kind' => ['sometimes', 'required', Rule::enum(LogSourceKind::class)],
            'allowed_origins' => [
                'nullable',
                'prohibited_unless:kind,'.LogSourceKind::Browser->value,
                'required_if:kind,'.LogSourceKind::Browser->value,
                'array',
                'list',
                'max:'.self::MAX_ALLOWED_ORIGINS,
            ],
            'allowed_origins.*' => ['required', 'string', 'max:255', static::originRule()],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                $project = $this->route('project');

                $error = $project instanceof Project ? $project->logSourceCreationError() : null;

                if ($error !== null) {
                    $validator->errors()->add('project', $error);
                }
            },
        ];
    }

    public function kind(): LogSourceKind
    {
        return LogSourceKind::from($this->validated('kind', LogSourceKind::Server->value));
    }

    /** @return list<string> */
    public function allowedOrigins(): array
    {
        return $this->kind() === LogSourceKind::Browser ? $this->validated('allowed_origins') : [];
    }

    /** Lowercases the origin and drops the default port, which browsers never send in Origin. */
    public static function normalizeOrigin(string $origin): string
    {
        $origin = strtolower($origin);

        return preg_replace(['~\A(https://[^/]+):443\z~', '~\A(http://[^/]+):80\z~'], '$1', $origin);
    }

    public static function originRule(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) {
            $valid = is_string($value)
                && preg_match(self::ORIGIN_PATTERN, $value, $matches) === 1
                && (! isset($matches['port']) || $matches['port'] === '' || (int) $matches['port'] <= 65535);

            if (! $valid) {
                $fail(__('Each allowed origin must be an exact origin like https://example.com, without path or trailing slash; plain http is only allowed for localhost and 127.0.0.1.'));
            }
        };
    }
}
