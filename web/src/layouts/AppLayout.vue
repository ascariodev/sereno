<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const organization = useOrganizationStore()
const loading = ref(false)
const failed = ref(false)

async function loadOrganizations(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    await organization.load()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

async function logout(): Promise<void> {
  await auth.logout()
  await router.push({ name: 'login' })
}

function onSelect(event: Event): void {
  organization.select(Number((event.target as HTMLSelectElement).value))
}

onMounted(() => {
  if (!organization.loaded) void loadOrganizations()
})
</script>

<template>
  <div class="app-layout">
    <header class="app-layout__header">
      <strong>{{ t('app.name') }}</strong>
      <label v-if="organization.organizations.length > 0" class="app-layout__org">
        <span>{{ t('organization.label') }}</span>
        <select name="organization" :value="organization.activeId ?? ''" @change="onSelect">
          <option v-for="item in organization.organizations" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
      </label>
      <span class="app-layout__spacer" />
      <span v-if="auth.user" class="app-layout__user">{{ auth.user.name }}</span>
      <button type="button" name="logout" @click="logout">{{ t('layout.logout') }}</button>
    </header>
    <main class="app-layout__main">
      <p v-if="loading">{{ t('organization.loading') }}</p>
      <p v-else-if="failed" role="alert">
        {{ t('organization.loadFailed') }}
        <button type="button" name="retry" @click="loadOrganizations">{{ t('organization.retry') }}</button>
      </p>
      <p v-else-if="organization.loaded && organization.activeId === null" class="app-layout__empty">
        {{ t('organization.none') }}
      </p>
      <RouterView v-else-if="organization.activeId !== null" />
    </main>
  </div>
</template>

<style scoped>
.app-layout__header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}

.app-layout__org {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.app-layout__spacer {
  flex: 1;
}

.app-layout__main {
  padding: 1rem;
}
</style>
