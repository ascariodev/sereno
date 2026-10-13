<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('notifications');
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->ana = User::factory()->create();
    $this->bob = User::factory()->create();
    foreach ([$this->ana, $this->bob] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->other->addMember($this->ana, [Role::Member]);
    $this->outsider = User::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->otherProject = Project::factory()->for($this->other)->create();
    assignMembersToAllProjects();
});

function inboxNotification(User $user, Organization $organization, ?Project $project = null, bool $read = false, string $type = 'task_assigned'): int
{
    return DB::table('notifications')->insertGetId([
        'uuid' => (string) Str::uuid(),
        'organization_id' => $organization->id,
        'user_id' => $user->id,
        'project_id' => $project?->id,
        'type' => $type,
        'subject_type' => Project::class,
        'subject_id' => $project?->id ?? 1,
        'data' => json_encode(['title' => 'Hello']),
        'read_at' => $read ? now() : null,
    ]);
}

function notificationCall(?User $user, ?Organization $organization, string $method, string $uri, array $data = [])
{
    if ($user) {
        Sanctum::actingAs($user);
    }
    $test = $organization ? test()->withHeader('X-Organization-Id', (string) $organization->id) : test();

    return $test->json($method, $uri, $data);
}

function notificationRead(int $id): mixed
{
    return DB::table('notifications')->where('id', $id)->value('read_at');
}

it('lists own notifications of the active organization newest first with the full shape', function () {
    $first = inboxNotification($this->ana, $this->organization, $this->project, read: true);
    $second = inboxNotification($this->ana, $this->organization, null, type: 'mention');
    inboxNotification($this->bob, $this->organization, $this->project);
    inboxNotification($this->ana, $this->other, $this->otherProject);

    $response = notificationCall($this->ana, $this->organization, 'GET', '/api/notifications')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $second)
        ->assertJsonPath('data.0.type', 'mention')
        ->assertJsonPath('data.0.project_id', null)
        ->assertJsonPath('data.0.read_at', null)
        ->assertJsonPath('data.0.data', ['title' => 'Hello'])
        ->assertJsonPath('data.1.id', $first)
        ->assertJsonPath('data.1.project_id', $this->project->id)
        ->assertJsonPath('meta.unread_count', 1)
        ->assertJsonStructure(['data' => [['id', 'type', 'project_id', 'data', 'read_at', 'created_at']], 'links', 'meta' => ['next_cursor', 'unread_count']]);

    expect($response->json('data.1.read_at'))->not->toBeNull()
        ->and(array_keys($response->json('data.0')))->toBe(['id', 'type', 'project_id', 'data', 'read_at', 'created_at']);
});

it('scopes the list and the unread count to the active organization', function () {
    inboxNotification($this->ana, $this->organization, $this->project);
    inboxNotification($this->ana, $this->other, $this->otherProject);
    inboxNotification($this->ana, $this->other, $this->otherProject);

    notificationCall($this->ana, $this->other, 'GET', '/api/notifications')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread_count', 2);
});

it('paginates with a cursor and validates the query', function () {
    $ids = collect(range(1, 3))->map(fn () => inboxNotification($this->ana, $this->organization, $this->project));

    $page = notificationCall($this->ana, $this->organization, 'GET', '/api/notifications?per_page=2')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread_count', 3);
    $cursor = $page->json('meta.next_cursor');
    expect($cursor)->not->toBeNull();

    notificationCall($this->ana, $this->organization, 'GET', '/api/notifications?per_page=2&cursor='.urlencode($cursor))
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $ids[0])->assertJsonPath('meta.next_cursor', null);

    notificationCall($this->ana, $this->organization, 'GET', '/api/notifications?cursor=garbage')
        ->assertUnprocessable()->assertJsonValidationErrors('cursor');
    notificationCall($this->ana, $this->organization, 'GET', '/api/notifications?per_page=101')
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');
});

it('does not run extra queries per notification', function () {
    foreach (range(1, 2) as $i) {
        inboxNotification($this->ana, $this->organization, $this->project);
    }
    Sanctum::actingAs($this->ana);
    $count = function () {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->withHeader('X-Organization-Id', (string) $this->organization->id)->getJson('/api/notifications')->assertOk();

        return count(DB::getQueryLog());
    };
    $count();
    $few = $count();
    foreach (range(1, 6) as $i) {
        inboxNotification($this->ana, $this->organization, $this->project);
    }

    expect($count())->toBe($few);
});

it('requires authentication, an organization and membership', function () {
    $this->getJson('/api/notifications')->assertUnauthorized();
    $this->postJson('/api/notifications/read', ['all' => true])->assertUnauthorized();
    notificationCall($this->ana, null, 'GET', '/api/notifications')->assertStatus(400);
    notificationCall($this->outsider, $this->organization, 'GET', '/api/notifications')->assertForbidden();
    notificationCall($this->outsider, $this->organization, 'POST', '/api/notifications/read', ['all' => true])->assertForbidden();
});

it('marks only the given own notifications as read and returns the new unread count', function () {
    $a = inboxNotification($this->ana, $this->organization, $this->project);
    $b = inboxNotification($this->ana, $this->organization, $this->project);
    $bobs = inboxNotification($this->bob, $this->organization, $this->project);
    $elsewhere = inboxNotification($this->ana, $this->other, $this->otherProject);

    notificationCall($this->ana, $this->organization, 'POST', '/api/notifications/read', ['ids' => [$a, $bobs, $elsewhere, 999999]])
        ->assertOk()->assertExactJson(['unread_count' => 1]);

    expect(notificationRead($a))->not->toBeNull()
        ->and(notificationRead($b))->toBeNull()
        ->and(notificationRead($bobs))->toBeNull()
        ->and(notificationRead($elsewhere))->toBeNull();
});

it('marks all own notifications of the active organization as read and is idempotent', function () {
    $mine = inboxNotification($this->ana, $this->organization, $this->project);
    inboxNotification($this->ana, $this->organization);
    $bobs = inboxNotification($this->bob, $this->organization, $this->project);
    $elsewhere = inboxNotification($this->ana, $this->other, $this->otherProject);

    notificationCall($this->ana, $this->organization, 'POST', '/api/notifications/read', ['all' => true])
        ->assertOk()->assertExactJson(['unread_count' => 0]);
    $stamp = notificationRead($mine);

    $this->travel(5)->minutes();
    notificationCall($this->ana, $this->organization, 'POST', '/api/notifications/read', ['all' => true])
        ->assertOk()->assertExactJson(['unread_count' => 0]);

    expect($stamp)->not->toBeNull()
        ->and(notificationRead($mine))->toBe($stamp)
        ->and(notificationRead($bobs))->toBeNull()
        ->and(notificationRead($elsewhere))->toBeNull();
});

it('validates the read payload with translated messages', function () {
    $post = fn (array $data) => notificationCall($this->ana, $this->organization, 'POST', '/api/notifications/read', $data);

    $post([])->assertUnprocessable()->assertJsonValidationErrors('ids');
    $post(['all' => false])->assertUnprocessable()->assertJsonValidationErrors('ids');
    $post(['ids' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('ids');
    $post(['ids' => [0]])->assertUnprocessable()->assertJsonValidationErrors('ids.0');
    $post(['ids' => range(1, 101)])->assertUnprocessable()->assertJsonValidationErrors('ids');
    $post(['all' => 'maybe'])->assertUnprocessable()->assertJsonValidationErrors('all');

    $en = $post([])->json('errors.ids.0');
    $es = $this->withHeader('Accept-Language', 'es')->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson('/api/notifications/read')->json('errors.ids.0');
    expect($es)->not->toBe($en);
});

it('throttles the inbox per user', function () {
    foreach (range(1, 60) as $i) {
        notificationCall($this->ana, $this->organization, 'GET', '/api/notifications')->assertOk();
    }

    notificationCall($this->ana, $this->organization, 'GET', '/api/notifications')->assertTooManyRequests();
    notificationCall($this->bob, $this->organization, 'GET', '/api/notifications')->assertOk();
    notificationCall($this->bob, $this->organization, 'POST', '/api/notifications/read', ['all' => true])->assertOk();
});

it('hides notifications of projects the member cannot see and shows them to admins', function () {
    $visible = inboxNotification($this->ana, $this->organization, $this->project);
    $hiddenProject = Project::factory()->for($this->organization)->create();
    $hidden = inboxNotification($this->ana, $this->organization, $hiddenProject);

    notificationCall($this->ana, $this->organization, 'GET', '/api/notifications')
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $visible)->assertJsonPath('meta.unread_count', 1);

    notificationCall($this->ana, $this->organization, 'POST', '/api/notifications/read', ['all' => true])
        ->assertOk()->assertJsonPath('unread_count', 0);
    notificationCall($this->ana, $this->organization, 'POST', '/api/notifications/read', ['ids' => [$hidden]])->assertOk();
    expect(notificationRead($hidden))->toBeNull();

    DB::table('project_user')->insert([
        'organization_id' => $this->organization->id, 'project_id' => $hiddenProject->id, 'user_id' => $this->ana->id,
        'created_at' => now(), 'updated_at' => now(),
    ]);
    notificationCall($this->ana, $this->organization, 'GET', '/api/notifications')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread_count', 1);

    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);
    $adminOwn = inboxNotification($admin, $this->organization, $hiddenProject);
    notificationCall($admin, $this->organization, 'GET', '/api/notifications')
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $adminOwn);
});
