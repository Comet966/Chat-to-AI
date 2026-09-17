import type { ConversationNodeId } from 'chat-conversation-tree'

export interface ConversationRuntimeIdGenerator {
  nextRequestId(): string
  nextUserNodeId(): ConversationNodeId
  nextAssistantNodeId(): ConversationNodeId
}

export class DefaultConversationRuntimeIdGenerator implements ConversationRuntimeIdGenerator {
  private counter = 0

  public nextRequestId(): string {
    const ts = Date.now()
    const rand = Math.random().toString(36).substring(2, 8)
    return `req-${ts}-${rand}-${++this.counter}`
  }

  public nextUserNodeId(): ConversationNodeId {
    const ts = Date.now()
    const rand = Math.random().toString(36).substring(2, 8)
    return `u-${ts}-${rand}-${++this.counter}`
  }

  public nextAssistantNodeId(): ConversationNodeId {
    const ts = Date.now()
    const rand = Math.random().toString(36).substring(2, 8)
    return `a-${ts}-${rand}-${++this.counter}`
  }
}
