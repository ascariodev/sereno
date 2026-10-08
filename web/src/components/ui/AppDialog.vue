<script setup lang="ts">
import { X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    hideTitle?: boolean
    variant?: 'center' | 'sheet-left' | 'sheet-right' | 'sheet-bottom'
    closeLabel?: string
  }>(),
  { variant: 'center' },
)

const open = defineModel<boolean>('open', { default: false })

const describedBy = computed(() => (props.description ? {} : { 'aria-describedby': undefined }))
const hasHeader = computed(() => !props.hideTitle || Boolean(props.closeLabel))
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="app-dialog-overlay" />
      <DialogContent class="app-dialog" :class="`app-dialog--${variant}`" v-bind="describedBy">
        <div v-if="hasHeader" class="app-dialog__header">
          <DialogTitle class="app-dialog__title" :class="{ 'app-dialog__hidden': hideTitle }">{{ title }}</DialogTitle>
          <DialogClose v-if="closeLabel" class="app-dialog__close" :aria-label="closeLabel" name="close-dialog">
            <X :size="18" aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogTitle v-else class="app-dialog__hidden">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="app-dialog__description">{{ description }}</DialogDescription>
        <div class="app-dialog__body">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.app-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 20, 0.45);
  z-index: 40;
}
.app-dialog-overlay[data-state='open'] {
  animation: app-dialog-fade-in 160ms ease-out;
}
.app-dialog-overlay[data-state='closed'] {
  animation: app-dialog-fade-out 120ms ease-in;
}
.app-dialog {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--border);
  box-shadow: 0 16px 48px rgba(21, 23, 28, 0.2);
  z-index: 41;
  outline: none;
}
.app-dialog--center {
  top: 50%;
  left: 50%;
  width: min(480px, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100dvh - 2 * var(--space-6));
  border-radius: var(--radius-panel);
  transform: translate(-50%, -50%);
}
.app-dialog--sheet-left {
  top: 0;
  left: 0;
  bottom: 0;
  width: min(320px, calc(100vw - 48px));
  border-width: 0 1px 0 0;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
}
.app-dialog--sheet-right {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(360px, calc(100vw - 48px));
  border-width: 0 0 0 1px;
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-bottom: env(safe-area-inset-bottom);
}
.app-dialog--sheet-bottom {
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 85dvh;
  border-width: 1px 0 0;
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.app-dialog--center[data-state='open'] {
  animation: app-dialog-center-in 160ms ease-out;
}
.app-dialog--center[data-state='closed'] {
  animation: app-dialog-center-out 120ms ease-in;
}
.app-dialog--sheet-left[data-state='open'] {
  animation: app-dialog-left-in 200ms ease-out;
}
.app-dialog--sheet-left[data-state='closed'] {
  animation: app-dialog-left-out 160ms ease-in;
}
.app-dialog--sheet-right[data-state='open'] {
  animation: app-dialog-right-in 200ms ease-out;
}
.app-dialog--sheet-right[data-state='closed'] {
  animation: app-dialog-right-out 160ms ease-in;
}
.app-dialog--sheet-bottom[data-state='open'] {
  animation: app-dialog-bottom-in 200ms ease-out;
}
.app-dialog--sheet-bottom[data-state='closed'] {
  animation: app-dialog-bottom-out 160ms ease-in;
}
.app-dialog__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4) var(--space-2);
}
.app-dialog__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.app-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.app-dialog__close:hover {
  background: var(--bg);
  color: var(--ink);
}
.app-dialog__close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.app-dialog__description {
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  font-size: 13.5px;
  color: var(--ink-2);
}
.app-dialog__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-4) var(--space-4);
}
.app-dialog__hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@keyframes app-dialog-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes app-dialog-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes app-dialog-center-in {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); }
  to { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes app-dialog-center-out {
  from { opacity: 1; transform: translate(-50%, -50%); }
  to { opacity: 0; transform: translate(-50%, -48%) scale(0.98); }
}
@keyframes app-dialog-left-in {
  from { transform: translateX(-100%); }
  to { transform: none; }
}
@keyframes app-dialog-left-out {
  from { transform: none; }
  to { transform: translateX(-100%); }
}
@keyframes app-dialog-right-in {
  from { transform: translateX(100%); }
  to { transform: none; }
}
@keyframes app-dialog-right-out {
  from { transform: none; }
  to { transform: translateX(100%); }
}
@keyframes app-dialog-bottom-in {
  from { transform: translateY(100%); }
  to { transform: none; }
}
@keyframes app-dialog-bottom-out {
  from { transform: none; }
  to { transform: translateY(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .app-dialog-overlay[data-state],
  .app-dialog[data-state] {
    animation: none;
  }
}
</style>
