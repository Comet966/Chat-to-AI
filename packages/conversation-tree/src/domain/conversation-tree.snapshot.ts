import type { ConversationNode } from './conversation-node.js'
import type { ConversationNodeId, ConversationTreeId } from './conversation-tree.types.js'

export interface ConversationTreeSnapshot {
  readonly schemaVersion: 1
  readonly treeId: ConversationTreeId
  readonly rootId: ConversationNodeId
  readonly version: number
  readonly nextSequence: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly nodes: readonly ConversationNode[]
}

export interface ConversationBranch {
  readonly leafNodeId: ConversationNodeId
  readonly nodeIds: readonly ConversationNodeId[]
}

export interface ConversationTreeDescriptor {
  readonly treeId: ConversationTreeId
  readonly rootId: ConversationNodeId
  readonly version: number
  readonly nodeCount: number
  readonly leafCount: number
  readonly createdAt: string
  readonly updatedAt: string
}
