import type { ConversationNodeDraft } from '../domain/conversation-node.js'
import type {
  ConversationNodeId,
  ConversationTreeId
} from '../domain/conversation-tree.types.js'

export interface AppendNodeCommand {
  readonly treeId: ConversationTreeId
  readonly expectedVersion: number
  readonly parentId: ConversationNodeId
  readonly node: ConversationNodeDraft
}
