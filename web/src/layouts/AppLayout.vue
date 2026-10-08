<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AppSidebar from '../components/AppSidebar.vue'
import CommandPalette from '../components/CommandPalette.vue'
import MobileTopBar from '../components/MobileTopBar.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import { useOrganizationStore } from '../stores/organization'

const { t } = useI18n()
const organization = useOrganizationStore()
const route = useRoute()
const drawerOpen = ref(false)
const paletteOpen = ref(false)

watch(paletteOpen, (open) => {
  if (open) drawerOpen.value = false
})

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

function closeDrawerOnLink(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('a')) drawerOpen.value = false
}

watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  },
)

const wideQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)') : null

function closeDrawerWhenWide(event: MediaQueryListEvent): void {
  if (event.matches) drawerOpen.value = false
}

onMounted(() => {
  wideQuery?.addEventListener('change', closeDrawerWhenWide)
  if (!organization.loaded) void loadOrganizations()
})

onBeforeUnmount(() => {
  wideQuery?.removeEventListener('change', closeDrawerWhenWide)
})
</script>

<template>
  <div class="app-layout">
    <MobileTopBar class="app-layout__top-bar" :open="drawerOpen" @toggle="drawerOpen = !drawerOpen" />
    <AppDialog
      v-model:open="drawerOpen"
      variant="sheet-left"
      :title="t('sidebar.label')"
      hide-title
      :close-label="t('sidebar.close')"
    >
      <div @click="closeDrawerOnLink">
        <AppSidebar @search="paletteOpen = true" />
      </div>
    </AppDialog>
    <AppSidebar class="app-layout__sidebar" @search="paletteOpen = true" />
    <CommandPalette v-model:open="paletteOpen" />
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

.app-layout__top-bar {
  flex: 1 1 100%;
}

.app-layout__main {
  flex: 999 1 560px;
  min-width: 0;
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
}

@media (max-width: 767px) {
  .app-layout {
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 0;
    padding: 0;
  }

  .app-layout__top-bar {
    flex: none;
  }

  .app-layout__sidebar {
    display: none;
  }

  .app-layout__main {
    flex: 1 1 auto;
    padding: var(--space-3) calc(var(--space-3) + env(safe-area-inset-right))
      calc(var(--space-3) + env(safe-area-inset-bottom)) calc(var(--space-3) + env(safe-area-inset-left));
    border-width: 0;
    border-radius: 0;
  }
}
</style>
