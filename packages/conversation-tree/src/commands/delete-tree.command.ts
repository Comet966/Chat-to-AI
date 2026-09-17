import type { ConversationTreeId } from '../domain/conversation-tree.types.js'

export interface DeleteTreeCommand {
  readonly treeId: ConversationTreeId
  readonly expectedVersion: number
}
