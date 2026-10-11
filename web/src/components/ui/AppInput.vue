<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id: string
  label: string
  modelValue?: string
  errors?: string[]
  errorTest?: string
  describedbyExtra?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const input = ref<HTMLInputElement | null>(null)

const errorIds = computed(() => (props.errors ?? []).map((_, index) => `${props.id}-error-${index}`))
const describedBy = computed(() => {
  if (!errorIds.value.length) return undefined
  return [...errorIds.value, props.describedbyExtra].filter(Boolean).join(' ')
})

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="app-input">
    <label :for="id">{{ label }}</label>
    <input
      :id="id"
      ref="input"
      v-bind="$attrs"
      :value="modelValue"
      :aria-invalid="describedBy ? 'true' : undefined"
      :aria-describedby="describedBy"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
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
.app-input input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
}
.app-input input[readonly] {
  color: var(--ink-3);
}
.app-input input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.app-input__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
