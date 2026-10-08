<?php

namespace App\Http\Requests\Member;

use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UpdateMemberRoleRequest extends FormRequest
{
    /**
     * Runs before the rules, so non-privileged users get 403 before validation.
     * An unknown role is left to validation (422) once the actor is known to be owner/admin.
     */
    public function authorize(): bool
    {
        $role = is_string($input = $this->input('role')) ? Role::tryFrom($input) : null;

        return Gate::allows('updateRole', [$this->route('user'), $role]);
    }

    public function rules(): array
    {
        return [
            'role' => ['required', Rule::enum(Role::class)],
        ];
    }
}
