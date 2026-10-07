<?php

namespace Database\Seeders;

use App\Enums\LogLevel;
use App\Enums\Role;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->call(RoleSeeder::class);

        $user = User::firstOrCreate(
            ['email' => 'test@example.com'],
            User::factory()->make(['email' => 'test@example.com', 'name' => 'Test User'])->getAttributes(),
        );
        if ($user->email_verified_at === null) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        $organization = Organization::firstOrCreate(
            ['slug' => 'demo'],
            ['name' => 'Demo', 'settings' => ['default_locale' => 'en']],
        );
        $organization->addMember($user, [Role::Owner]);

        $current = app(CurrentOrganization::class);
        $previous = $current->get();
        $current->set($organization);

        try {
            $this->seedProject($organization, $user);
        } finally {
            $current->set($previous);
        }
    }

    private function seedProject(Organization $organization, User $user): void
    {
        $project = Project::where('key', 'DEMO')->first()
            ?? $this->create(new Project, $organization, [
                'key' => 'DEMO',
                'name' => 'Demo project',
                'description' => 'Sample project for local development.',
            ]);
        $channel = $project->channel()->first()
            ?? $this->create(new Channel, $organization, ['project_id' => $project->id, 'name' => $project->key]);

        if ($channel->messages()->exists()) {
            return;
        }

        $group = $this->create(new LogGroup, $organization, [
            'fingerprint' => hash('sha256', 'demo-seed'),
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'project_id' => $project->id,
            'level' => LogLevel::Error,
            'title' => 'Call to undefined method on null',
            'events_count' => 3,
        ]);

        foreach (['Welcome to the demo channel.', 'Log alerts for this project show up here.'] as $body) {
            $this->create(new Message, $organization, [
                'channel_id' => $channel->id,
                'kind' => Message::KIND_USER,
                'body' => $body,
                'user_id' => $user->id,
            ]);
        }

        $notices = [
            [null, ['type' => 'log.group_opened', 'log_group_id' => $group->id, 'level' => 'error', 'title' => $group->title, 'events_count' => 1]],
            [$user, ['type' => 'log.group_status_changed', 'log_group_id' => $group->id, 'status' => 'resolved', 'previous_status' => 'open']],
        ];

        foreach ($notices as [$actor, $payload]) {
            $this->create(new Message, $organization, [
                'channel_id' => $channel->id,
                'kind' => Message::KIND_SYSTEM,
                'payload' => $payload,
                'log_group_id' => $group->id,
                'user_id' => $actor?->id,
            ]);
        }
    }

    /**
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  TModel  $model
     * @return TModel
     */
    private function create($model, Organization $organization, array $attributes)
    {
        $model->forceFill([...$attributes, 'organization_id' => $organization->id])->save();

        return $model;
    }
}
