<?php

use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
});

it('blocks moving a project with log sources to another organization', function () {
    LogSource::factory()->for($this->project)->create();

    $this->project->organization_id = $this->other->id;
    $this->project->save();
})->throws(InvalidArgumentException::class);

it('blocks moving a project with log groups to another organization', function () {
    LogGroup::factory()->for($this->project)->create();

    $this->project->organization_id = $this->other->id;
    $this->project->save();
})->throws(InvalidArgumentException::class);

it('allows moving a project without sources or groups', function () {
    $this->project->organization_id = $this->other->id;
    $this->project->save();

    expect($this->project->fresh()->organization_id)->toBe($this->other->id);
});
