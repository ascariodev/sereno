<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AppSidebar from '../components/AppSidebar.vue'
import CommandPalette from '../components/CommandPalette.vue'
import MobileTopBar from '../components/MobileTopBar.vue'
import OrganizationCreateDialog from '../components/OrganizationCreateDialog.vue'
import ProjectCreateDialog from '../components/ProjectCreateDialog.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import { openProjectCreateKey } from '../composables/useProjectCreate'
import { useMembershipWatch } from '../realtime/useMembershipWatch'
import { useAuthStore } from '../stores/auth'
import { useMentionsStore } from '../stores/mentions'
import { useOrganizationStore } from '../stores/organization'

const { t } = useI18n()
const organization = useOrganizationStore()
const route = useRoute()
const auth = useAuthStore()
const mentions = useMentionsStore()
const drawerOpen = ref(false)
const paletteOpen = ref(false)
const orgCreateOpen = ref(false)
const projectCreateOpen = ref(false)

provide(openProjectCreateKey, () => {
  projectCreateOpen.value = true
})

useMembershipWatch()

watch(
  () => auth.user?.id,
  (userId) => {
    if (userId === undefined) mentions.stop()
    else mentions.start(userId)
  },
  { immediate: true },
)

const SIDEBAR_STORAGE_KEY = 'workspace.sidebar'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

const sidebarCollapsed = ref(readCollapsed())

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed.value ? 'collapsed' : 'expanded')
  } catch {
    // storage unavailable: the choice lasts for this session
  }
}

watch(paletteOpen, (open) => {
  if (open) drawerOpen.value = false
})

watch([orgCreateOpen, projectCreateOpen], ([orgOpen, projectOpen]) => {
  if (orgOpen || projectOpen) drawerOpen.value = false
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
  if (!(event.target instanceof Element)) return
  const link = event.target.closest('a')
  if (link && link.target !== '_blank' && link.origin === window.location.origin) drawerOpen.value = false
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
  mentions.stop()
  wideQuery?.removeEventListener('change', closeDrawerWhenWide)
})
</script>

<template>
  <div
    :class="[
      'app-layout',
      { 'app-layout--fixed': route.name === 'channel', 'app-layout--collapsed': sidebarCollapsed },
    ]"
  >
    <MobileTopBar class="app-layout__top-bar" :open="drawerOpen" @toggle="drawerOpen = !drawerOpen" @search="paletteOpen = true" />
    <AppDialog
      v-model:open="drawerOpen"
      variant="sheet-left"
      :title="t('sidebar.menu')"
      hide-title
      :close-label="t('sidebar.close')"
    >
      <div @click="closeDrawerOnLink">
        <AppSidebar
          @search="paletteOpen = true"
          @create-organization="orgCreateOpen = true"
          @create-project="projectCreateOpen = true"
        />
      </div>
    </AppDialog>
    <AppSidebar
      class="app-layout__sidebar"
      collapsible
      :collapsed="sidebarCollapsed"
      @search="paletteOpen = true"
      @toggle="toggleSidebar"
      @create-organization="orgCreateOpen = true"
      @create-project="projectCreateOpen = true"
    />
    <CommandPalette v-model:open="paletteOpen" />
    <OrganizationCreateDialog v-model:open="orgCreateOpen" />
    <ProjectCreateDialog v-model:open="projectCreateOpen" />
    <main class="app-layout__main">
      <p v-if="loading">{{ t('common.loading') }}</p>
      <p v-else-if="failed" role="alert">
        {{ t('organization.loadFailed') }}
        <button type="button" name="retry" @click="loadOrganizations">{{ t('common.retry') }}</button>
      </p>
      <p v-else-if="organization.loaded && organization.activeId === null" class="app-layout__empty">
        <strong>{{ t('organization.none') }}</strong>
        <span>{{ t('organization.noneHint') }}</span>
        <button type="button" name="create-organization" class="app-layout__create" @click="orgCreateOpen = true">
          {{ t('organization.create') }}
        </button>
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

.app-layout--collapsed .app-layout__sidebar {
  flex: 0 0 64px;
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

.app-layout__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.app-layout__create {
  min-height: 44px;
  margin-top: var(--space-2);
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.app-layout__empty strong {
  color: var(--ink-2);
}

.app-layout--fixed {
  flex-wrap: nowrap;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.app-layout--fixed .app-layout__main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
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
