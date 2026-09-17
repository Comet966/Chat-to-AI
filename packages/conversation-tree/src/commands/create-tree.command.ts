import type { ConversationNodeDraft } from '../domain/conversation-node.js'
import type { ConversationTreeId } from '../domain/conversation-tree.types.js'

export interface CreateTreeCommand {
  readonly treeId: ConversationTreeId
  readonly root: ConversationNodeDraft
}
