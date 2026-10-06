<?php

namespace App\Http\Requests\Invitation;

use App\Enums\Role;
use App\Models\Invitation;
use App\Support\CurrentOrganization;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class InviteRequest extends FormRequest
{
    /**
     * Runs before the rules, so non-privileged users get 403 without learning who is a member.
     * An unknown role is left to validation (422) once the user is known to be owner/admin.
     */
    public function authorize(): bool
    {
        $role = Role::tryFrom((string) $this->input('role'));

        return Gate::allows('create', [Invitation::class, $role]);
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('email'))) {
            $this->merge(['email' => mb_strtolower(trim($this->input('email')))]);
        }
    }

    public function rules(): array
    {
        return [
            'email' => [
                'required', 'string', 'email', 'max:255',
                function (string $attribute, mixed $value, Closure $fail) {
                    $isMember = app(CurrentOrganization::class)->get()
                        ->users()
                        ->whereRaw('lower(users.email) = ?', [$value])
                        ->exists();

                    if ($isMember) {
                        $fail(__('This user is already a member of the organization.'));
                    }
                },
            ],
            'role' => ['required', Rule::enum(Role::class)],
        ];
    }
}
