import type { ConversationNodeDraft } from '../domain/conversation-node.js'
import type {
  ConversationNodeId,
  ConversationTreeId
} from '../domain/conversation-tree.types.js'

export interface ForkFromNodeCommand {
  readonly treeId: ConversationTreeId
  readonly expectedVersion: number
  readonly parentId: ConversationNodeId
  readonly node: ConversationNodeDraft
}
