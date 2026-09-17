import { ConversationTree } from './conversation-tree.js'
import { createTreeError } from './domain/conversation-tree.errors.js'
import type {
  ConversationTreeDescriptor,
  ConversationTreeSnapshot
} from './domain/conversation-tree.snapshot.js'
import type {
  ConversationTreeId,
  ConversationTreeResult
} from './domain/conversation-tree.types.js'
import type { ConversationTreeRepository } from './ports/conversation-tree.repository.js'

function cloneSnapshot(snapshot: ConversationTreeSnapshot): ConversationTreeSnapshot {
  return structuredClone(snapshot)
}

export class InMemoryConversationTreeRepository implements ConversationTreeRepository {
  private readonly storage = new Map<ConversationTreeId, ConversationTreeSnapshot>()

  public async create(snapshot: ConversationTreeSnapshot): Promise<ConversationTreeResult<void>> {
    if (this.storage.has(snapshot.treeId)) {
      return {
        ok: false,
        error: createTreeError(
          'TREE_ALREADY_EXISTS',
          `Conversation tree with id "${snapshot.treeId}" already exists`
        )
      }
    }

    this.storage.set(snapshot.treeId, cloneSnapshot(snapshot))
    return { ok: true, value: undefined }
  }

  public async load(treeId: ConversationTreeId): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const found = this.storage.get(treeId)
    if (!found) {
      return {
        ok: false,
        error: createTreeError(
          'TREE_NOT_FOUND',
          `Conversation tree with id "${treeId}" not found`
        )
      }
    }

    return {
      ok: true,
      value: cloneSnapshot(found)
    }
  }

  public async save(
    snapshot: ConversationTreeSnapshot,
    expectedVersion: number
  ): Promise<ConversationTreeResult<void>> {
    const existing = this.storage.get(snapshot.treeId)
    if (!existing) {
      return {
        ok: false,
        error: createTreeError(
          'TREE_NOT_FOUND',
          `Conversation tree with id "${snapshot.treeId}" not found`
        )
      }
    }

    if (existing.version !== expectedVersion) {
      return {
        ok: false,
        error: createTreeError(
          'VERSION_CONFLICT',
          `Version conflict on tree "${snapshot.treeId}": expected ${expectedVersion}, current ${existing.version}`
        )
      }
    }

    this.storage.set(snapshot.treeId, cloneSnapshot(snapshot))
    return { ok: true, value: undefined }
  }

  public async delete(
    treeId: ConversationTreeId,
    expectedVersion: number
  ): Promise<ConversationTreeResult<void>> {
    const existing = this.storage.get(treeId)
    if (!existing) {
      return {
        ok: false,
        error: createTreeError(
          'TREE_NOT_FOUND',
          `Conversation tree with id "${treeId}" not found`
        )
      }
    }

    if (existing.version !== expectedVersion) {
      return {
        ok: false,
        error: createTreeError(
          'VERSION_CONFLICT',
          `Version conflict on deleting tree "${treeId}": expected ${expectedVersion}, current ${existing.version}`
        )
      }
    }

    this.storage.delete(treeId)
    return { ok: true, value: undefined }
  }

  public async list(): Promise<ConversationTreeResult<readonly ConversationTreeDescriptor[]>> {
    const descriptors: ConversationTreeDescriptor[] = []

    for (const snapshot of this.storage.values()) {
      const treeResult = ConversationTree.hydrate(cloneSnapshot(snapshot))
      if (treeResult.ok) {
        descriptors.push(treeResult.value.toDescriptor())
      }
    }

    descriptors.sort((a, b) => {
      const timeDiff = a.createdAt.localeCompare(b.createdAt)
      if (timeDiff !== 0) return timeDiff
      return a.treeId.localeCompare(b.treeId)
    })

    return {
      ok: true,
      value: descriptors
    }
  }
}
