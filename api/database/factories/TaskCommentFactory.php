<?php

namespace Database\Factories;

use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TaskComment>
 */
class TaskCommentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'body' => fake()->sentence(),
        ];
    }

    public function forTask(Task $task): static
    {
        return $this->state([
            'task_id' => $task->id,
            'organization_id' => $task->organization_id,
        ]);
    }
}
