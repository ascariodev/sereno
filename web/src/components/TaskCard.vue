<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import type { Task } from '../api/types'
import AppAvatar from './ui/AppAvatar.vue'
import LevelPill from './ui/LevelPill.vue'
import ProjectKey from './ui/ProjectKey.vue'
import TaskMoveMenu from './TaskMoveMenu.vue'

const props = defineProps<{ task: Task; readOnly?: boolean }>()
const { t } = useI18n()
const route = useRoute()

const titleId = computed(() => `task-${props.task.id}-title`)
const metaId = computed(() => `task-${props.task.id}-meta`)
const to = computed(() => ({ query: { ...route.query, task: String(props.task.id) } }))
const group = computed(() => props.task.log_group ?? null)
const assignee = computed(() => props.task.assignee ?? null)
</script>

<template>
  <div class="task-card-wrap">
  <RouterLink class="task-card" :to="to" :aria-labelledby="titleId" :aria-describedby="metaId">
    <span v-if="group" class="task-card__notice">
      <LevelPill :level="group.level" />
      <span class="task-card__events">{{ group.events_count }} {{ t('notice.eventsWord', group.events_count) }}</span>
    </span>
    <span :id="titleId" class="task-card__title">{{ task.title }}</span>
    <span :id="metaId" class="task-card__meta">
      <ProjectKey :value="task.key" />
      <span class="task-card__spacer"></span>
      <AppAvatar v-if="assignee" :name="assignee.name" :id="assignee.id" :size="24" />
      <span class="sr-only">
        {{ assignee ? t('plan.assignedTo', { name: assignee.name }) : t('plan.unassigned') }}
        <template v-if="group">. {{ t('plan.fromNotice') }}</template>
      </span>
    </span>
  </RouterLink>
  <TaskMoveMenu class="task-card__move" :task="task" :read-only="readOnly" />
  </div>
</template>

<style scoped>
.task-card-wrap {
  position: relative;
}
.task-card__move {
  position: absolute;
  top: 8px;
  right: 8px;
}
.task-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
}
.task-card:hover {
  border-color: var(--accent);
}
.task-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.task-card__notice {
  align-self: flex-start;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.task-card__events {
  font-size: 12px;
  color: var(--ink-3);
}
.task-card__title {
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.task-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-3);
}
.task-card__spacer {
  flex: 1;
}
</style>
