<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from './toast'

const props = defineProps<{ text: string; label: string }>()

const { t } = useI18n()
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.text)
  } catch {
    toast.error(t('copyButton.failed'))
    return
  }
  toast.success(t('copyButton.copied'))
  copied.value = true
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => (copied.value = false), 2000)
}

onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <button type="button" class="copy-button" :aria-label="label" @click="copy">
    <Check v-if="copied" :size="16" aria-hidden="true" />
    <Copy v-else :size="16" aria-hidden="true" />
  </button>
</template>

<style scoped>
.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
}
.copy-button:hover {
  background: var(--bg);
  color: var(--ink);
}
.copy-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
