<script setup lang="ts">
import { CircleAlert, CircleCheck, X } from '@lucide/vue'
import { ToastClose, ToastDescription, ToastProvider, ToastRoot, ToastViewport } from 'reka-ui'
import { toast, toasts } from './toast'

defineProps<{ label: string; closeLabel: string }>()

function onOpenChange(id: number, open: boolean) {
  if (!open) toast.dismiss(id)
}
</script>

<template>
  <ToastProvider :label="label" :duration="4000" swipe-direction="right">
    <ToastRoot
      v-for="item in toasts"
      :key="item.id"
      class="app-toast"
      :class="`app-toast--${item.kind}`"
      :type="item.kind === 'error' ? 'foreground' : 'background'"
      :open="item.open"
      :duration="item.duration"
      @update:open="onOpenChange(item.id, $event)"
    >
      <CircleAlert v-if="item.kind === 'error'" class="app-toast__icon" :size="18" aria-hidden="true" />
      <CircleCheck v-else class="app-toast__icon" :size="18" aria-hidden="true" />
      <ToastDescription class="app-toast__message">{{ item.message }}</ToastDescription>
      <ToastClose class="app-toast__close" :aria-label="closeLabel" name="close-toast">
        <X :size="16" aria-hidden="true" />
      </ToastClose>
    </ToastRoot>
    <ToastViewport class="app-toast-viewport" :label="label" />
  </ToastProvider>
</template>

<style>
.app-toast-viewport {
  position: fixed;
  right: max(var(--space-4), env(safe-area-inset-right));
  bottom: calc(88px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(360px, calc(100vw - 2 * var(--space-4)));
  margin: 0;
  padding: 0;
  list-style: none;
  outline: none;
  z-index: 70;
}
.app-toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 8px 24px rgba(21, 23, 28, 0.16);
  font-size: 13.5px;
  line-height: 1.4;
}
.app-toast--success .app-toast__icon {
  color: var(--status-resolved-fg);
}
.app-toast--error .app-toast__icon {
  color: var(--level-error-fg);
}
.app-toast__icon {
  flex: none;
  margin-top: 1px;
}
.app-toast__message {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.app-toast__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.app-toast__close:hover {
  background: var(--bg);
  color: var(--ink);
}
.app-toast__close:focus-visible,
.app-toast:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.app-toast[data-state='open'] {
  animation: app-toast-in 160ms ease-out;
}
.app-toast[data-state='closed'] {
  animation: app-toast-out 120ms ease-in;
}
.app-toast[data-swipe='move'] {
  transform: translateX(var(--reka-toast-swipe-move-x));
}
.app-toast[data-swipe='cancel'] {
  transform: none;
  transition: transform 150ms ease-out;
}
.app-toast[data-swipe='end'] {
  animation: app-toast-swipe-out 120ms ease-out;
}
@keyframes app-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@keyframes app-toast-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes app-toast-swipe-out {
  from { transform: translateX(var(--reka-toast-swipe-end-x)); }
  to { transform: translateX(calc(100% + var(--space-4))); }
}
@media (max-width: 767px) {
  .app-toast-viewport {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    bottom: calc(96px + env(safe-area-inset-bottom));
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-toast[data-state],
  .app-toast[data-swipe] { animation: none; transition: none; }
}
</style>
