<script setup lang="ts">
import ProjectKey from './ui/ProjectKey.vue'

defineProps<{
  name: string
  projectKey: string
  description?: string | null
  channelName?: string | null
}>()
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
    <slot name="tabs" />
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
</style>
