<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../components/AppSidebar.vue'
import { useOrganizationStore } from '../stores/organization'

const { t } = useI18n()
const organization = useOrganizationStore()
const loading = ref(false)
const failed = ref(false)
let latestLoad = 0

async function loadOrganizations(): Promise<void> {
  const current = ++latestLoad
  loading.value = true
  failed.value = false
  try {
    await organization.load()
  } catch {
    failed.value = true
  } finally {
    if (current === latestLoad) loading.value = false
  }
}

onMounted(() => {
  if (!organization.loaded) void loadOrganizations()
})
</script>

<template>
  <div class="app-layout">
    <AppSidebar class="app-layout__sidebar" />
    <main class="app-layout__main">
      <p v-if="loading">{{ t('common.loading') }}</p>
      <p v-else-if="failed" role="alert">
        {{ t('organization.loadFailed') }}
        <button type="button" name="retry" @click="loadOrganizations">{{ t('common.retry') }}</button>
      </p>
      <p v-else-if="organization.loaded && organization.activeId === null" class="app-layout__empty">
        {{ t('organization.none') }}
      </p>
      <RouterView v-else-if="organization.activeId !== null" />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-height: 100vh;
  padding: var(--space-2);
  box-sizing: border-box;
}

.app-layout__sidebar {
  flex: 1 1 248px;
  min-width: 0;
}

.app-layout__main {
  flex: 999 1 560px;
  min-width: 0;
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
}
</style>
