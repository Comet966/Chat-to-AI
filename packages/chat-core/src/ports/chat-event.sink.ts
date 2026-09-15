import type { ChatEvent } from 'chat-contracts'

export interface ChatEventSink {
  emit(event: ChatEvent): void
}
