export type MessageId = string
export type ConversationId = string
export type ChatRole = 'system' | 'user' | 'assistant'
export type MessageStatus = 'complete' | 'streaming' | 'failed' | 'cancelled'

export interface MessageNode {
  id: MessageId
  conversationId: ConversationId
  parentId: MessageId | null
  role: ChatRole
  content: string
  status: MessageStatus
  createdAt: string
  modelId?: string
}
