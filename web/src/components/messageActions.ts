import type { InjectionKey, Ref } from 'vue'
import type { Message } from '../api/types'

export interface MessageActions {
  edit(message: Message): void
  /** `origin` says which panel hosts the message, to return focus there once the confirmation closes. */
  remove(message: Message, origin?: 'thread'): void
  /** Id of the single message being edited, or null. */
  editingId: Readonly<Ref<number | null>>
  /** Id of the root whose thread panel is open; the panel hosts that root's editor, not the channel list. */
  threadRootId: Readonly<Ref<number | null>>
  stopEdit(): void
}

export const messageActionsKey: InjectionKey<MessageActions> = Symbol('messageActions')
