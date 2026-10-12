<script setup lang="ts">
defineProps<{ projectId?: number; taskId: number; taskKey: string }>()
</script>

<template>
  <RouterLink
    v-if="projectId !== undefined"
    class="system-notice-line__task"
    :to="{ name: 'project-plan', params: { projectId }, query: { task: String(taskId) } }"
  >
    {{ taskKey }}
  </RouterLink>
  <b v-else class="system-notice-line__task">{{ taskKey }}</b>
</template>
