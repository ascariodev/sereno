<script setup lang="ts">
import { ChevronsUpDown, Plus } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOrganizationStore } from '../stores/organization'
import AppMenu from './ui/AppMenu.vue'

const CREATE_VALUE = 'create'

const emit = defineEmits<{ create: [] }>()
const { t } = useI18n()
const organization = useOrganizationStore()

const items = computed(() => [
  ...organization.organizations.map((item) => ({
    value: String(item.id),
    label: item.name,
    checked: item.id === organization.activeId,
  })),
  { value: CREATE_VALUE, label: t('orgCreate.title'), icon: Plus },
])

function onSelect(value: string): void {
  if (value === CREATE_VALUE) emit('create')
  else organization.select(Number(value))
}
const activeName = computed(
  () => organization.organizations.find((item) => item.id === organization.activeId)?.name ?? '',
)
const label = computed(() => (activeName.value ? `${t('organization.label')}: ${activeName.value}` : t('organization.label')))
</script>

<template>
  <AppMenu v-if="organization.organizations.length > 0" :items="items" @select="onSelect">
    <button type="button" name="organization" class="org-switcher" :aria-label="label">
      <span class="org-switcher__name">{{ activeName }}</span>
      <ChevronsUpDown :size="15" aria-hidden="true" />
    </button>
  </AppMenu>
</template>

<style scoped>
.org-switcher {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: calc(100% - 8px);
  min-height: 40px;
  margin: 0 4px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  cursor: pointer;
}

.org-switcher__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
