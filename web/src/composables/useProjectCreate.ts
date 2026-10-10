import { inject, type InjectionKey } from 'vue'

export const openProjectCreateKey: InjectionKey<() => void> = Symbol('openProjectCreate')

export function useOpenProjectCreate(): () => void {
  return inject(openProjectCreateKey, () => {})
}
