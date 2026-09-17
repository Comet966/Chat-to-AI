import type { DeleteNodeMode } from '../conversation-tree.js'
import type {
  ConversationNodeId,
  ConversationTreeId
} from '../domain/conversation-tree.types.js'

export interface DeleteNodeCommand {
  readonly treeId: ConversationTreeId
  readonly expectedVersion: number
  readonly nodeId: ConversationNodeId
  readonly mode?: DeleteNodeMode
}
