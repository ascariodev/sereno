<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id: string
  label: string
  modelValue?: string
  errors?: string[]
  errorTest?: string
  describedby?: string
  invalid?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const field = ref<HTMLSelectElement | null>(null)

const errorIds = computed(() => (props.errors ?? []).map((_, index) => `${props.id}-error-${index}`))
const describedBy = computed(() => [...errorIds.value, props.describedby].filter(Boolean).join(' ') || undefined)

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}

defineExpose({ focus: () => field.value?.focus() })
</script>

<template>
  <div class="app-select">
    <label :for="id">{{ label }}</label>
    <select
      :id="id"
      ref="field"
      v-bind="$attrs"
      :value="modelValue"
      :aria-invalid="invalid || errorIds.length ? 'true' : undefined"
      :aria-describedby="describedBy"
      @change="onChange"
    >
      <slot />
    </select>
    <p
      v-for="(message, index) in errors"
      :id="`${id}-error-${index}`"
      :key="`${index}-${message}`"
      class="app-select__error"
      :data-test="errorTest"
    >
      {{ message }}
    </p>
  </div>
</template>

<style scoped>
.app-select {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.app-select label {
  font-size: 13px;
  font-weight: 600;
}
.app-select select {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.app-select select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.app-select__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
