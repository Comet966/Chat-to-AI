import type { ConversationId, MessageId } from './domain/message.js'

export type ChatErrorCode =
  | 'INVALID_REQUEST'
  | 'REQUEST_IN_PROGRESS'
  | 'PROVIDER_UNAUTHORIZED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_ABORTED'
  | 'UNKNOWN'

export interface ChatPublicError {
  code: ChatErrorCode
  message: string
  retryable: boolean
}

export type ChatStreamStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ChatEventBase {
  requestId: string
  conversationId: ConversationId
  assistantMessageId: MessageId
  emittedAt: string
}

export type ChatEvent =
  | (ChatEventBase & { type: 'chat.stream.started' })
  | (ChatEventBase & { type: 'chat.stream.delta'; sequence: number; delta: string })
  | (ChatEventBase & { type: 'chat.stream.completed'; finishReason: 'stop' | 'length' | 'unknown' })
  | (ChatEventBase & { type: 'chat.stream.cancelled' })
  | (ChatEventBase & { type: 'chat.stream.failed'; error: ChatPublicError })
