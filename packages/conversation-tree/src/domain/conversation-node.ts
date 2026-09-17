import type {
  ConversationNodeId,
  ConversationRole,
  ConversationTreeId,
  GenerationProvenance
} from './conversation-tree.types.js'

export interface ConversationNode {
  readonly id: ConversationNodeId
  readonly treeId: ConversationTreeId
  readonly parentId: ConversationNodeId | null
  readonly role: ConversationRole
  readonly content: string
  readonly sequence: number
  readonly createdAt: string
  readonly generatedBy?: GenerationProvenance
}

export interface ConversationNodeDraft {
  readonly id: ConversationNodeId
  readonly role: ConversationRole
  readonly content: string
  readonly generatedBy?: GenerationProvenance
}
