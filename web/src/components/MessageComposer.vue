<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { useMessagesStore } from '../stores/messages'

const MAX_LENGTH = 4000

const { t } = useI18n()
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
  try {
    await messages.send(body.value)
    body.value = ''
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
    <textarea
      v-model="body"
      name="body"
      rows="2"
      :placeholder="t('channel.composer.placeholder')"
      :aria-label="t('channel.composer.placeholder')"
      @keydown="onKeydown"
    />
    <p v-if="tooLong" role="alert">{{ t('channel.composer.tooLong', { max: MAX_LENGTH }) }}</p>
    <p v-else-if="errorText" role="alert">{{ errorText }}</p>
    <button type="submit" name="send" :disabled="!canSend">{{ t('channel.composer.send') }}</button>
  </form>
</template>

<style scoped>
.composer {
  display: grid;
  gap: 0.5rem;
  margin-top: 1rem;
}

.composer textarea {
  resize: vertical;
  font: inherit;
}
</style>
