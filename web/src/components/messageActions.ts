import type { InjectionKey } from 'vue'
import type { Message } from '../api/types'

export interface MessageActions {
  edit(message: Message): void
  remove(message: Message): void
}

export const messageActionsKey: InjectionKey<MessageActions> = Symbol('messageActions')
