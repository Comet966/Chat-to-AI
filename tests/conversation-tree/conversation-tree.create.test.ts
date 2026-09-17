import { describe, expect, it } from 'vitest'
import {
  ConversationTree,
  type Clock,
  type ConversationTreeSnapshot
} from 'chat-conversation-tree'

const fixedClock: Clock = {
  now: () => '2026-09-16T10:00:00.000Z'
}

describe('ConversationTree - Creation and Hydration', () => {
  it('should successfully create a tree with a single root node', () => {
    const result = ConversationTree.create(
      {
        treeId: 'tree-1',
        root: {
          id: 'root-node-1',
          role: 'user',
          content: 'Hello tree!'
        }
      },
      fixedClock
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const tree = result.value
    const snapshot = tree.toSnapshot()

    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.treeId).toBe('tree-1')
    expect(snapshot.rootId).toBe('root-node-1')
    expect(snapshot.version).toBe(1)
    expect(snapshot.nextSequence).toBe(1)
    expect(snapshot.createdAt).toBe('2026-09-16T10:00:00.000Z')
    expect(snapshot.updatedAt).toBe('2026-09-16T10:00:00.000Z')
    expect(snapshot.nodes).toHaveLength(1)

    const rootNode = snapshot.nodes[0]
    expect(rootNode.id).toBe('root-node-1')
    expect(rootNode.parentId).toBeNull()
    expect(rootNode.sequence).toBe(0)
    expect(rootNode.role).toBe('user')
    expect(rootNode.content).toBe('Hello tree!')
    expect(rootNode.createdAt).toBe('2026-09-16T10:00:00.000Z')

    const descriptor = tree.toDescriptor()
    expect(descriptor.treeId).toBe('tree-1')
    expect(descriptor.nodeCount).toBe(1)
    expect(descriptor.leafCount).toBe(1)
    expect(descriptor.version).toBe(1)
  })

  it('should reject empty treeId, nodeId, or content', () => {
    const emptyTreeId = ConversationTree.create({
      treeId: '   ',
      root: { id: 'r1', role: 'user', content: 'test' }
    })
    expect(emptyTreeId.ok).toBe(false)
    if (!emptyTreeId.ok) {
      expect(emptyTreeId.error.code).toBe('TREE_ID_MISMATCH')
    }

    const emptyNodeId = ConversationTree.create({
      treeId: 'tree-1',
      root: { id: '', role: 'user', content: 'test' }
    })
    expect(emptyNodeId.ok).toBe(false)
    if (!emptyNodeId.ok) {
      expect(emptyNodeId.error.code).toBe('DUPLICATE_NODE_ID')
    }

    const emptyContent = ConversationTree.create({
      treeId: 'tree-1',
      root: { id: 'r1', role: 'user', content: '   ' }
    })
    expect(emptyContent.ok).toBe(false)
    if (!emptyContent.ok) {
      expect(emptyContent.error.code).toBe('INVALID_NODE_CONTENT')
    }
  })

  it('should allow assistant node to carry generatedBy provenance and reject user/system carrying it', () => {
    const assistantResult = ConversationTree.create({
      treeId: 'tree-1',
      root: {
        id: 'r1',
        role: 'assistant',
        content: 'I am an assistant',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4o' }
      }
    })
    expect(assistantResult.ok).toBe(true)

    const userResult = ConversationTree.create({
      treeId: 'tree-1',
      root: {
        id: 'r1',
        role: 'user',
        content: 'User message',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4o' }
      }
    })
    expect(userResult.ok).toBe(false)
    if (!userResult.ok) {
      expect(userResult.error.code).toBe('INVALID_GENERATION_PROVENANCE')
    }

    const systemResult = ConversationTree.create({
      treeId: 'tree-1',
      root: {
        id: 'r1',
        role: 'system',
        content: 'System prompt',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4o' }
      }
    })
    expect(systemResult.ok).toBe(false)
    if (!systemResult.ok) {
      expect(systemResult.error.code).toBe('INVALID_GENERATION_PROVENANCE')
    }
  })

  it('should perform flawless snapshot round-trip', () => {
    const createRes = ConversationTree.create({
      treeId: 'tree-1',
      root: { id: 'r1', role: 'user', content: 'First' }
    })
    expect(createRes.ok).toBe(true)
    if (!createRes.ok) return

    const originalTree = createRes.value
    originalTree.appendNode({
      parentId: 'r1',
      node: {
        id: 'a1',
        role: 'assistant',
        content: 'Response',
        generatedBy: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }
      }
    })

    const snapshot1 = originalTree.toSnapshot()
    const hydrateRes = ConversationTree.hydrate(snapshot1)
    expect(hydrateRes.ok).toBe(true)
    if (!hydrateRes.ok) return

    const hydratedTree = hydrateRes.value
    const snapshot2 = hydratedTree.toSnapshot()

    expect(snapshot2).toEqual(snapshot1)
    expect(hydratedTree.toDescriptor()).toEqual(originalTree.toDescriptor())
  })

  it('should reject unsupported schema version', () => {
    const invalidSnapshot: ConversationTreeSnapshot = {
      schemaVersion: 2 as unknown as 1,
      treeId: 't1',
      rootId: 'r1',
      version: 1,
      nextSequence: 1,
      createdAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      nodes: [
        {
          id: 'r1',
          treeId: 't1',
          parentId: null,
          role: 'user',
          content: 'Hello',
          sequence: 0,
          createdAt: '2026-09-16T10:00:00.000Z'
        }
      ]
    }

    const res = ConversationTree.hydrate(invalidSnapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('UNSUPPORTED_SNAPSHOT_VERSION')
    }
  })

  it('should reject unsupported roles at runtime', () => {
    const result = ConversationTree.create({
      treeId: 'tree-1',
      root: {
        id: 'r1',
        role: 'tool' as 'user',
        content: 'Untrusted input'
      }
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_NODE_ROLE')
    }
  })

  it('should reject malformed snapshot metadata at runtime', () => {
    const baseSnapshot: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: 'tree-1',
      rootId: 'r1',
      version: 1,
      nextSequence: 1,
      createdAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      nodes: [
        {
          id: 'r1',
          treeId: 'tree-1',
          parentId: null,
          role: 'user',
          content: 'Hello',
          sequence: 0,
          createdAt: '2026-09-16T10:00:00.000Z'
        }
      ]
    }

    const invalidSequence = ConversationTree.hydrate({
      ...baseSnapshot,
      nextSequence: 1.5
    })
    expect(invalidSequence.ok).toBe(false)
    if (!invalidSequence.ok) {
      expect(invalidSequence.error.code).toBe('INVALID_SEQUENCE')
    }

    const invalidVersion = ConversationTree.hydrate({
      ...baseSnapshot,
      version: 0
    })
    expect(invalidVersion.ok).toBe(false)
    if (!invalidVersion.ok) {
      expect(invalidVersion.error.code).toBe('INVALID_SNAPSHOT_METADATA')
    }

    const invalidRole = ConversationTree.hydrate({
      ...baseSnapshot,
      nodes: [{ ...baseSnapshot.nodes[0], role: 'tool' as 'user' }]
    })
    expect(invalidRole.ok).toBe(false)
    if (!invalidRole.ok) {
      expect(invalidRole.error.code).toBe('INVALID_NODE_ROLE')
    }

    const invalidNode = ConversationTree.hydrate({
      ...baseSnapshot,
      nodes: [null as unknown as ConversationTreeSnapshot['nodes'][number]]
    })
    expect(invalidNode.ok).toBe(false)
    if (!invalidNode.ok) {
      expect(invalidNode.error.code).toBe('INVALID_SNAPSHOT_METADATA')
    }
  })
})
