import type {
  ConversationTreeDescriptor,
  ConversationTreeSnapshot
} from '../domain/conversation-tree.snapshot.js'
import type {
  ConversationTreeId,
  ConversationTreeResult
} from '../domain/conversation-tree.types.js'

export interface ConversationTreeRepository {
  create(snapshot: ConversationTreeSnapshot): Promise<ConversationTreeResult<void>>
  load(treeId: ConversationTreeId): Promise<ConversationTreeResult<ConversationTreeSnapshot>>
  save(
    snapshot: ConversationTreeSnapshot,
    expectedVersion: number
  ): Promise<ConversationTreeResult<void>>
  delete(treeId: ConversationTreeId, expectedVersion: number): Promise<ConversationTreeResult<void>>
  list(): Promise<ConversationTreeResult<readonly ConversationTreeDescriptor[]>>
}
