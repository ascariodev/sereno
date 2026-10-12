<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id: string
  label: string
  modelValue?: string
  errors?: string[]
  errorTest?: string
  describedby?: string
  multiline?: boolean
  rows?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const slots = useSlots()
const field = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

const errorIds = computed(() => (props.errors ?? []).map((_, index) => `${props.id}-error-${index}`))
const hintId = computed(() => (slots.hint ? `${props.id}-hint` : undefined))
const describedBy = computed(
  () => [hintId.value, ...errorIds.value, props.describedby].filter(Boolean).join(' ') || undefined,
)

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}

defineExpose({ focus: () => field.value?.focus() })
</script>

<template>
  <div class="app-input">
    <label :for="id">{{ label }}</label>
    <textarea
      v-if="multiline"
      :id="id"
      ref="field"
      v-bind="$attrs"
      :rows="rows ?? 3"
      :value="modelValue"
      :aria-invalid="errorIds.length ? 'true' : undefined"
      :aria-describedby="describedBy"
      @input="onInput"
    />
    <input
      v-else
      :id="id"
      ref="field"
      v-bind="$attrs"
      :value="modelValue"
      :aria-invalid="errorIds.length ? 'true' : undefined"
      :aria-describedby="describedBy"
      @input="onInput"
    />
    <p v-if="hintId" :id="hintId" class="app-input__hint"><slot name="hint" /></p>
    <p
      v-for="(message, index) in errors"
      :id="`${id}-error-${index}`"
      :key="`${index}-${message}`"
      class="app-input__error"
      :data-test="errorTest"
    >
      {{ message }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
.app-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.app-input label {
  font-size: 13px;
  font-weight: 600;
}
.app-input input,
.app-input textarea {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.app-input textarea {
  padding-block: 10px;
  resize: vertical;
}
.app-input input[readonly] {
  color: var(--ink-3);
}
.app-input input:focus-visible,
.app-input textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.app-input__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}
.app-input__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
