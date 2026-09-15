import type { ChatRole, ConversationId, MessageId } from './domain/message.js'
import type { ChatPublicError } from './chat.events.js'

export interface StartChatCommand {
  requestId: string
  conversationId: ConversationId
  assistantMessageId: MessageId
  messages: ReadonlyArray<{
    role: ChatRole
    content: string
  }>
}

export type StartChatResult =
  | { requestId: string; accepted: true }
  | { requestId: string; accepted: false; error: ChatPublicError }

export interface CancelChatCommand {
  requestId: string
}

export interface CancelChatResult {
  requestId: string
  cancelled: boolean
}
