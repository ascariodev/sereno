<?php

namespace App\Http\Requests\Auth;

use App\Models\Invitation;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    /**
     * Runs before validation so a closed registration never answers with a 422 that would reveal
     * whether an email is already registered.
     */
    public function authorize(): bool
    {
        if (config('auth.registration_enabled')) {
            return true;
        }

        $plainToken = $this->input('invitation_token');
        $email = $this->input('email');

        if (! is_string($plainToken) || $plainToken === '' || ! is_string($email)) {
            return false;
        }

        $invitation = Invitation::findByPlainToken($plainToken);

        return $invitation !== null
            && $invitation->isUsable()
            && mb_strtolower($invitation->email) === mb_strtolower($email)
            && $invitation->inviterCanStillGrantRole();
    }

    protected function failedAuthorization(): void
    {
        throw new AuthorizationException(__('Registration is closed.'));
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::defaults()],
            'device_name' => ['nullable', 'string', 'max:255'],
        ];
    }
}
