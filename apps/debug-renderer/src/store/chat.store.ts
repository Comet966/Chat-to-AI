import { create } from 'zustand'
import type {
  ChatPublicError,
  ChatStreamStatus,
  ConversationId,
  MessageId,
  MessageNode
} from 'chat-contracts'

export interface ChatState {
  conversationId: ConversationId
  messages: MessageNode[]
  streamStatus: ChatStreamStatus
  activeRequestId: string | null
  lastSequence: number
  error: ChatPublicError | null

  appendMessage(message: MessageNode): void
  appendDelta(messageId: MessageId, sequence: number, delta: string): void
  markStreamStarted(requestId: string): void
  markStreamCompleted(messageId: MessageId): void
  markStreamCancelled(messageId: MessageId): void
  markStreamFailed(messageId: MessageId, error: ChatPublicError): void
  resetConversation(): void
}

export function createConversationId(): ConversationId {
  return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export const useChatStore = create<ChatState>((set) => ({
  conversationId: createConversationId(),
  messages: [],
  streamStatus: 'idle',
  activeRequestId: null,
  lastSequence: -1,
  error: null,

  appendMessage: (message: MessageNode) => {
    set((state) => ({
      messages: [...state.messages, message]
    }))
  },

  appendDelta: (messageId: MessageId, sequence: number, delta: string) => {
    set((state) => {
      if (sequence <= state.lastSequence) {
        return state
      }

      const updatedMessages = state.messages.map((msg) => {
        if (msg.id === messageId) {
          return {
            ...msg,
            content: msg.content + delta,
            status: 'streaming' as const
          }
        }
        return msg
      })

      return {
        messages: updatedMessages,
        lastSequence: sequence,
        streamStatus: 'streaming'
      }
    })
  },

  markStreamStarted: (requestId: string) => {
    set({
      activeRequestId: requestId,
      streamStatus: 'starting',
      lastSequence: -1,
      error: null
    })
  },

  markStreamCompleted: (messageId: MessageId) => {
    set((state) => ({
      activeRequestId: null,
      streamStatus: 'completed',
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, status: 'complete' as const } : msg
      )
    }))
  },

  markStreamCancelled: (messageId: MessageId) => {
    set((state) => ({
      activeRequestId: null,
      streamStatus: 'cancelled',
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, status: 'cancelled' as const } : msg
      )
    }))
  },

  markStreamFailed: (messageId: MessageId, error: ChatPublicError) => {
    set((state) => ({
      activeRequestId: null,
      streamStatus: 'failed',
      error,
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, status: 'failed' as const } : msg
      )
    }))
  },

  resetConversation: () => {
    set({
      conversationId: createConversationId(),
      messages: [],
      streamStatus: 'idle',
      activeRequestId: null,
      lastSequence: -1,
      error: null
    })
  }
}))
