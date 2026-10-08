<script setup lang="ts">
import { SendHorizontal } from '@lucide/vue'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { useMessagesStore } from '../stores/messages'

const MAX_LENGTH = 4000

const { t } = useI18n()
const hintId = useId()
const messages = useMessagesStore()
const body = ref('')
const sending = ref(false)
const errorText = ref<string | null>(null)

const tooLong = computed(() => [...body.value].length > MAX_LENGTH)
const canSend = computed(() => !sending.value && !tooLong.value && body.value.trim() !== '')

async function submit(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  errorText.value = null
  const sentBody = body.value
  try {
    await messages.send(sentBody)
    if (body.value === sentBody) body.value = ''
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 422) {
      errorText.value = caught.errors?.body?.[0] ?? caught.message
    } else if (caught instanceof ApiError && caught.status === 429) {
      errorText.value = t('channel.composer.rateLimited')
    } else {
      errorText.value = t('channel.composer.sendFailed')
    }
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div class="composer-box">
      <textarea
        v-model="body"
        name="body"
        rows="2"
        :placeholder="t('channel.composer.placeholder')"
        :aria-label="t('channel.composer.placeholder')"
        :aria-describedby="hintId"
        @keydown="onKeydown"
      />
      <div class="composer-bar">
        <span :id="hintId" class="composer-hint">{{ t('channel.composer.hint') }}</span>
        <button
          type="submit"
          name="send"
          class="composer-send"
          :disabled="!canSend"
          :aria-label="t('channel.composer.send')"
        >
          <SendHorizontal :size="16" :stroke-width="2" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-if="tooLong" role="alert" class="composer-error">{{ t('channel.composer.tooLong', { max: MAX_LENGTH }) }}</p>
    <p v-else-if="errorText" role="alert" class="composer-error">{{ errorText }}</p>
  </form>
</template>

<style scoped>
.composer {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
}

.composer-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

.composer textarea {
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--ink);
  padding: 2px 0;
  font: inherit;
}

.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.composer-hint {
  flex: 1;
  font-size: 12px;
  color: var(--ink-3);
}

.composer-send {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius-control);
  background: var(--accent);
  color: var(--on-accent);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.composer-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.composer-send:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
}

.composer-error {
  margin: 0;
  font-size: 12px;
  color: var(--level-error-fg);
}
</style>
