<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSourceWithKey } from '../api/types'
import { config } from '../config'
import AppDialog from './ui/AppDialog.vue'
import CopyButton from './ui/CopyButton.vue'

const source = defineModel<LogSourceWithKey | null>('source', { default: null })

const { t } = useI18n()

const open = computed({
  get: () => source.value !== null,
  set: (value: boolean) => {
    if (!value) source.value = null
  },
})

const connected = computed(() => source.value?.last_used_at != null)

const ingestUrl = computed(() => `${config.apiUrl}/api/ingest/events`)

const installCommand = computed(
  () => `composer require ascariodev/sereno-laravel && php artisan sereno:install ${source.value?.key ?? ''} --url=${config.apiUrl}`,
)

const envBlock = computed(() => `SERENO_KEY=${source.value?.key ?? ''}\nSERENO_URL=${config.apiUrl}`)

const curlExample = computed(
  () =>
    `curl -X POST ${ingestUrl.value} \\\n` +
    `  -H "Authorization: Bearer ${source.value?.key ?? ''}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '{"events":[{"level":"error","message":"Test event"}]}'`,
)
</script>

<template>
  <AppDialog v-model:open="open" :title="t('keyDialog.title')" :description="t('keyDialog.description')" :close-label="t('keyDialog.close')">
    <div v-if="source" class="key-dialog">
      <p class="key-dialog__warning" role="alert" data-test="warning">{{ t('keyDialog.warning') }}</p>

      <p
        class="key-dialog__status"
        :class="{ 'key-dialog__status--connected': connected }"
        aria-live="polite"
        aria-atomic="true"
        data-test="status"
      >
        {{ connected ? t('keyDialog.connected') : t('keyDialog.waiting') }}
      </p>

      <section class="key-dialog__block">
        <h3 class="key-dialog__label">{{ t('keyDialog.install') }}</h3>
        <div class="key-dialog__row">
          <pre class="key-dialog__code" data-test="install">{{ installCommand }}</pre>
          <CopyButton :text="installCommand" :label="t('keyDialog.copyInstall')" />
        </div>
      </section>

      <section class="key-dialog__block">
        <h3 class="key-dialog__label">{{ t('keyDialog.key', { name: source.name }) }}</h3>
        <div class="key-dialog__row">
          <code class="key-dialog__code" data-test="key">{{ source.key }}</code>
          <CopyButton :text="source.key" :label="t('keyDialog.copyKey')" />
        </div>
      </section>

      <section class="key-dialog__block">
        <h3 class="key-dialog__label">{{ t('keyDialog.endpoint') }}</h3>
        <div class="key-dialog__row">
          <code class="key-dialog__code" data-test="endpoint">{{ ingestUrl }}</code>
          <CopyButton :text="ingestUrl" :label="t('keyDialog.copyEndpoint')" />
        </div>
      </section>

      <section class="key-dialog__block">
        <h3 class="key-dialog__label">{{ t('keyDialog.env') }}</h3>
        <div class="key-dialog__row">
          <pre class="key-dialog__code" data-test="env">{{ envBlock }}</pre>
          <CopyButton :text="envBlock" :label="t('keyDialog.copyEnv')" />
        </div>
      </section>

      <section class="key-dialog__block">
        <h3 class="key-dialog__label">{{ t('keyDialog.curl') }}</h3>
        <div class="key-dialog__row">
          <pre class="key-dialog__code" data-test="curl">{{ curlExample }}</pre>
          <CopyButton :text="curlExample" :label="t('keyDialog.copyCurl')" />
        </div>
      </section>

      <div class="key-dialog__actions">
        <button type="button" class="key-dialog__done" data-test="done" @click="open = false">{{ t('keyDialog.done') }}</button>
      </div>
    </div>
  </AppDialog>
</template>

<style scoped>
.key-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.key-dialog__warning {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  background: var(--accent-soft);
  color: var(--ink);
  font-size: 13.5px;
}
.key-dialog__status {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg);
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 600;
}
.key-dialog__status--connected {
  border-color: var(--level-info-fg);
  background: var(--level-info-bg);
  color: var(--level-info-fg);
}
.key-dialog__block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.key-dialog__label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.key-dialog__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.key-dialog__code {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg);
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.key-dialog__actions {
  display: flex;
  justify-content: flex-end;
}
.key-dialog__done {
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.key-dialog__done:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
