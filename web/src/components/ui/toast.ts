import { shallowRef } from 'vue'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onSelect: () => void
}

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  duration: number
  action?: ToastAction
  open: boolean
}

export interface ToastOptions {
  duration?: number
  action?: ToastAction
}

export const TOAST_LIMIT = 3
export const TOAST_DURATION = 4000
export const TOAST_ERROR_DURATION = 6000
const REMOVE_DELAY = 300

export const toasts = shallowRef<ToastItem[]>([])

let nextId = 0
const removeTimers = new Map<number, ReturnType<typeof setTimeout>>()

function push(kind: ToastKind, message: string, options: ToastOptions = {}): number {
  const id = ++nextId
  const duration = options.duration ?? (kind === 'error' ? TOAST_ERROR_DURATION : TOAST_DURATION)
  const alive = toasts.value.filter((item) => item.open)
  const overflow = alive.slice(0, Math.max(0, alive.length + 1 - TOAST_LIMIT))
  toasts.value = [...toasts.value.filter((item) => !overflow.includes(item)), { id, kind, message, duration, action: options.action, open: true }]
  return id
}

function dismiss(id: number): void {
  const target = toasts.value.find((item) => item.id === id)
  if (!target || !target.open) return
  toasts.value = toasts.value.map((item) => (item.id === id ? { ...item, open: false } : item))
  removeTimers.set(id, setTimeout(() => remove(id), REMOVE_DELAY))
}

function remove(id: number): void {
  removeTimers.delete(id)
  toasts.value = toasts.value.filter((item) => item.id !== id)
}

function clear(): void {
  removeTimers.forEach((timer) => clearTimeout(timer))
  removeTimers.clear()
  toasts.value = []
}

export const toast = {
  success: (message: string, options?: ToastOptions) => push('success', message, options),
  error: (message: string, options?: ToastOptions) => push('error', message, options),
  info: (message: string, options?: ToastOptions) => push('info', message, options),
  dismiss,
  clear,
}
