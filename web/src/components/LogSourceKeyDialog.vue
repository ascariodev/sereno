<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSourceWithKey } from '../api/types'
import { config } from '../config'
import AppDialog from './ui/AppDialog.vue'
import AppSegmented from './ui/AppSegmented.vue'
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

type TabId = 'laravel' | 'php' | 'node' | 'python' | 'browser' | 'curl'

interface Snippet {
  id: string
  label: string
  copyLabel: string
  text: string
}

const SERVER_TABS: TabId[] = ['laravel', 'php', 'node', 'python', 'curl']
const BROWSER_TABS: TabId[] = ['browser']

const tabIds = computed<TabId[]>(() => (source.value?.kind === 'browser' ? BROWSER_TABS : SERVER_TABS))
const selectedTab = ref<TabId>('laravel')
const activeTab = computed<TabId>(() => (tabIds.value.includes(selectedTab.value) ? selectedTab.value : tabIds.value[0]))

const tabOptions = computed(() =>
  tabIds.value.map((id) => ({ value: id, label: t(`keyDialog.tab.${id}`) })),
)

function selectTab(value: string): void {
  selectedTab.value = value as TabId
}

const phpCode = computed(
  () =>
    `<?php\n\nrequire __DIR__.'/vendor/autoload.php';\n\nuse Sereno\\Sereno;\n\n` +
    `$logger = Sereno::init(); // reads SERENO_KEY and SERENO_URL from the environment\n\n` +
    `$logger->error('Payment failed', ['order_id' => 42]);`,
)

const nodeCode = computed(
  () =>
    `import { init, captureException, log } from '@ascariodev/sereno-node';\n\n` +
    `init(); // reads SERENO_URL and SERENO_KEY from the environment\n\n` +
    `log('warning', 'Payment is slow', { order_id: 42 });`,
)

const pythonCode = computed(
  () =>
    `import logging\nimport sereno\n\n` +
    `sereno.init()  # reads SERENO_URL and SERENO_KEY from the environment\n\n` +
    `logging.getLogger(__name__).warning("Payment is slow", extra={"order_id": 42})`,
)

const browserCode = computed(
  () =>
    `import { init, captureException, log } from '@ascariodev/sereno-browser';\n\n` +
    `init({\n  url: '${config.apiUrl}',\n  key: '${source.value?.key ?? ''}',\n});\n\n` +
    `log('warning', 'Checkout is slow', { step: 'payment' });`,
)

const vueCode = `import { SerenoVue } from '@ascariodev/sereno-browser/vue';\n\napp.use(SerenoVue);`

const snippets = computed<Snippet[]>(() => {
  const env: Snippet = { id: 'env', label: t('keyDialog.env'), copyLabel: t('keyDialog.copyEnv'), text: envBlock.value }
  const code = (text: string): Snippet => ({ id: 'code', label: t('keyDialog.code'), copyLabel: t('keyDialog.copyCode'), text })
  const install = (text: string): Snippet => ({ id: 'install', label: t('keyDialog.install'), copyLabel: t('keyDialog.copyInstall'), text })
  switch (activeTab.value) {
    case 'laravel':
      return [install(installCommand.value), env]
    case 'php':
      return [install('composer require ascariodev/sereno-php'), env, code(phpCode.value)]
    case 'node':
      return [install('npm install @ascariodev/sereno-node'), env, code(nodeCode.value)]
    case 'python':
      return [install('pip install sereno-sdk'), env, code(pythonCode.value)]
    case 'browser':
      return [
        install('npm install @ascariodev/sereno-browser'),
        code(browserCode.value),
        { id: 'vue', label: t('keyDialog.vue'), copyLabel: t('keyDialog.copyVue'), text: vueCode },
      ]
    default:
      return [{ id: 'curl', label: t('keyDialog.curl'), copyLabel: t('keyDialog.copyCurl'), text: curlExample.value }]
  }
})
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

      <AppSegmented :model-value="activeTab" :options="tabOptions" :label="t('keyDialog.languages')" @update:model-value="selectTab" />

      <p v-if="activeTab === 'browser'" class="key-dialog__origins" data-test="origin-notice">
        {{ t('keyDialog.browserOrigin') }}
        <code v-if="source.allowed_origins?.length">{{ source.allowed_origins.join(', ') }}</code>
      </p>

      <section v-for="snippet in snippets" :key="`${activeTab}-${snippet.id}`" class="key-dialog__block">
        <h3 class="key-dialog__label">{{ snippet.label }}</h3>
        <div class="key-dialog__row">
          <pre class="key-dialog__code" :data-test="snippet.id">{{ snippet.text }}</pre>
          <CopyButton :text="snippet.text" :label="snippet.copyLabel" />
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
.key-dialog__origins {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
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
