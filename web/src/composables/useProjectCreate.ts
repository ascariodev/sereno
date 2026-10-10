import { inject, type InjectionKey } from 'vue'

export const openProjectCreateKey: InjectionKey<() => void> = Symbol('openProjectCreate')

export function useOpenProjectCreate(): () => void {
  return inject(openProjectCreateKey, () => {
    if (import.meta.env.DEV) {
      console.warn('useOpenProjectCreate: no provider found, the call does nothing')
    }
  })
}
