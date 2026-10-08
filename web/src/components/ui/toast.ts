import { shallowRef } from 'vue'

export type ToastKind = 'success' | 'error'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  duration: number
  open: boolean
}

export interface ToastOptions {
  duration?: number
}

export const TOAST_LIMIT = 3
export const TOAST_DURATION = 4000
export const TOAST_ERROR_DURATION = 6000
const REMOVE_DELAY = 300

export const toasts = shallowRef<ToastItem[]>([])

let nextId = 0

function push(kind: ToastKind, message: string, options: ToastOptions = {}): number {
  const id = ++nextId
  const duration = options.duration ?? (kind === 'error' ? TOAST_ERROR_DURATION : TOAST_DURATION)
  const alive = toasts.value.filter((item) => item.open)
  const overflow = alive.slice(0, Math.max(0, alive.length + 1 - TOAST_LIMIT))
  toasts.value = [...toasts.value.filter((item) => !overflow.includes(item)), { id, kind, message, duration, open: true }]
  return id
}

function dismiss(id: number): void {
  const target = toasts.value.find((item) => item.id === id)
  if (!target || !target.open) return
  toasts.value = toasts.value.map((item) => (item.id === id ? { ...item, open: false } : item))
  setTimeout(() => remove(id), REMOVE_DELAY)
}

function remove(id: number): void {
  toasts.value = toasts.value.filter((item) => item.id !== id)
}

function clear(): void {
  toasts.value = []
}

export const toast = {
  success: (message: string, options?: ToastOptions) => push('success', message, options),
  error: (message: string, options?: ToastOptions) => push('error', message, options),
  dismiss,
  clear,
}
