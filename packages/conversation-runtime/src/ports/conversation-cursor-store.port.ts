import type {
  ConversationNodeId,
  ConversationTreeId
} from 'chat-conversation-tree'

export interface ConversationCursorStore {
  get(treeId: ConversationTreeId): ConversationNodeId | undefined
  set(treeId: ConversationTreeId, nodeId: ConversationNodeId): void
  delete(treeId: ConversationTreeId): void
}

export class InMemoryConversationCursorStore implements ConversationCursorStore {
  private readonly cursors = new Map<ConversationTreeId, ConversationNodeId>()

  public get(treeId: ConversationTreeId): ConversationNodeId | undefined {
    return this.cursors.get(treeId)
  }

  public set(treeId: ConversationTreeId, nodeId: ConversationNodeId): void {
    this.cursors.set(treeId, nodeId)
  }

  public delete(treeId: ConversationTreeId): void {
    this.cursors.delete(treeId)
  }
}
