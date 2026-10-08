<script setup lang="ts">
import { Activity, MessageSquare } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import ProjectKey from './ui/ProjectKey.vue'

defineProps<{
  name: string
  projectKey: string
  description?: string | null
  channelName?: string | null
  projectId?: number
  channelId?: number | null
}>()

const { t } = useI18n()
</script>

<template>
  <header class="project-header">
    <div class="project-header__identity">
      <ProjectKey :value="projectKey" />
      <h1 class="project-header__name">
        {{ name }}
        <small v-if="channelName" class="project-header__channel">{{ channelName }}</small>
      </h1>
      <span v-if="description" class="project-header__description" :title="description">{{ description }}</span>
    </div>
    <slot name="tabs">
      <nav v-if="projectId !== undefined" class="project-header__tabs" :aria-label="t('projectTabs.label')">
        <RouterLink v-if="channelId" :to="{ name: 'channel', params: { id: channelId } }" class="project-header__tab">
          <MessageSquare :size="15" aria-hidden="true" />
          {{ t('projectTabs.channel') }}
        </RouterLink>
        <span v-else class="project-header__tab project-header__tab--disabled" aria-disabled="true">
          <MessageSquare :size="15" aria-hidden="true" />
          {{ t('projectTabs.channel') }}
        </span>
        <RouterLink :to="{ name: 'project-log', params: { projectId } }" class="project-header__tab">
          <Activity :size="15" aria-hidden="true" />
          {{ t('projectTabs.log') }}
        </RouterLink>
      </nav>
    </slot>
    <slot name="actions" />
  </header>
</template>

<style scoped>
.project-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}

.project-header__identity {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 260px;
  min-width: 0;
}

.project-header__name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.project-header__channel {
  margin-left: 8px;
  color: var(--ink-3);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
}

.project-header__description {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-header__tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg);
  border-radius: var(--radius-control);
}

.project-header__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--ink-2);
  font-weight: 500;
  text-decoration: none;
}

.project-header__tab--disabled {
  opacity: 0.6;
}

.project-header__tab[aria-current='page'] {
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(21, 23, 28, 0.08);
  color: var(--ink);
  font-weight: 600;
}

.project-header__tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
