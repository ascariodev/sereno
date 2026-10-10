<?php

namespace App\Http\Requests\ProjectMember;

use App\Enums\Role;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreProjectMemberRequest extends FormRequest
{
    /**
     * Runs before the rules: the user_id check queries the organization's members, so unauthorized
     * users get 403 and never a 422 that tells them who belongs to the organization.
     */
    public function authorize(): bool
    {
        return Gate::allows('manageMembers', $this->route('project'));
    }

    public function rules(): array
    {
        return [
            'user_id' => [
                'required', 'integer',
                Rule::exists('organization_user', 'user_id')
                    ->where('organization_id', app(CurrentOrganization::class)->id()),
            ],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->has('user_id')) {
                    return;
                }

                $user = User::query()->find($this->integer('user_id'));

                if ($user === null || ! $user->hasRole(Role::Member->value)) {
                    $validator->errors()->add('user_id', __('Only users with the member role can be assigned to a project.'));
                }
            },
        ];
    }
}
