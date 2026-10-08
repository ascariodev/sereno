<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { levelTone } from '../api/logLevels'
import type { Project } from '../api/types'
import ProjectKey from './ui/ProjectKey.vue'

const props = defineProps<{ project: Pick<Project, 'id' | 'name' | 'key' | 'description'> & Partial<Pick<Project, 'open_groups_count' | 'open_max_level'>>; channelId?: number }>()
const { t } = useI18n()

const health = computed(() => {
  const count = props.project.open_groups_count
  if (typeof count !== 'number') return null
  if (count <= 0) return { tone: 'calm', text: t('projects.healthCalm') }
  const level = props.project.open_max_level
  const tone = levelTone(level)
  return { tone, text: `${t('projects.healthOpen', { n: count }, count)} · ${t(`notice.level.${tone}`)}` }
})

const describedBy = computed(() => {
  const ids: string[] = []
  if (props.project.description) ids.push(`project-${props.project.id}-description`)
  if (health.value) ids.push(`project-${props.project.id}-health`)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <component
    :is="channelId ? RouterLink : 'div'"
    :to="channelId ? { name: 'channel', params: { id: channelId } } : undefined"
    class="project-card"
    :class="{ 'project-card--link': channelId }"
    :aria-labelledby="channelId ? `project-${project.id}-name` : undefined"
    :aria-describedby="channelId ? describedBy : undefined"
  >
    <span class="project-card__head">
      <ProjectKey :value="project.key" />
      <span :id="`project-${project.id}-name`" class="project-card__name" :title="project.name">{{ project.name }}</span>
    </span>
    <span v-if="project.description" :id="`project-${project.id}-description`" class="project-card__description">{{ project.description }}</span>
    <span v-if="health" :id="`project-${project.id}-health`" class="project-card__health" :data-tone="health.tone">
      <span class="project-card__dot" aria-hidden="true" />{{ health.text }}
    </span>
  </component>
</template>

<style scoped>
.project-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 112px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
}

.project-card--link:hover {
  border-color: var(--accent);
}

.project-card--link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.project-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-card__name {
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card__description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  color: var(--ink-2);
  font-size: 13.5px;
}

.project-card__health {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  color: var(--ink-2);
  font-size: 13px;
}

.project-card__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
}

.project-card__health[data-tone='debug'] .project-card__dot { background: var(--level-debug-fg); }
.project-card__health[data-tone='info'] .project-card__dot { background: var(--level-info-fg); }
.project-card__health[data-tone='notice'] .project-card__dot { background: var(--level-notice-fg); }
.project-card__health[data-tone='warning'] .project-card__dot { background: var(--level-warning-fg); }
.project-card__health[data-tone='error'] .project-card__dot { background: var(--level-error-fg); }
.project-card__health[data-tone='critical'] .project-card__dot { background: var(--level-critical-bg); }
.project-card__health[data-tone='alert'] .project-card__dot { background: var(--level-alert-bg); }
.project-card__health[data-tone='emergency'] .project-card__dot { background: var(--level-emergency-bg); }
</style>
