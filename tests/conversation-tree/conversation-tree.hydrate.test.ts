import { describe, expect, it } from 'vitest'
import {
  ConversationTree,
  type ConversationTreeSnapshot
} from 'chat-conversation-tree'

describe('ConversationTree - Hydration', () => {
  const validSnapshot: ConversationTreeSnapshot = {
    schemaVersion: 1,
    treeId: 'tree-hydrate-1',
    rootId: 'root',
    version: 3,
    nextSequence: 4,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:05:00.000Z',
    nodes: [
      {
        id: 'root',
        treeId: 'tree-hydrate-1',
        parentId: null,
        role: 'user',
        content: 'Root prompt',
        sequence: 0,
        createdAt: '2026-09-16T10:00:00.000Z'
      },
      {
        id: 'a1',
        treeId: 'tree-hydrate-1',
        parentId: 'root',
        role: 'assistant',
        content: 'Assistant reply',
        sequence: 1,
        createdAt: '2026-09-16T10:01:00.000Z',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4o' }
      },
      {
        id: 'u2',
        treeId: 'tree-hydrate-1',
        parentId: 'a1',
        role: 'user',
        content: 'Next question',
        sequence: 2,
        createdAt: '2026-09-16T10:02:00.000Z'
      }
    ]
  }

  it('should hydrate valid snapshot into fully operational ConversationTree', () => {
    const res = ConversationTree.hydrate(validSnapshot)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const tree = res.value
    expect(tree.hasNode('root')).toBe(true)
    expect(tree.hasNode('a1')).toBe(true)
    expect(tree.hasNode('u2')).toBe(true)
    expect(tree.hasNode('non-existent')).toBe(false)

    const desc = tree.toDescriptor()
    expect(desc.treeId).toBe('tree-hydrate-1')
    expect(desc.rootId).toBe('root')
    expect(desc.nodeCount).toBe(3)
    expect(desc.leafCount).toBe(1)
    expect(desc.version).toBe(3)

    // Should be able to append new nodes to hydrated tree
    const appendRes = tree.appendNode({
      parentId: 'u2',
      node: {
        id: 'a2',
        role: 'assistant',
        content: 'Answer 2',
        generatedBy: { providerId: 'gemini', modelId: 'gemini-1.5-pro' }
      }
    })
    expect(appendRes.ok).toBe(true)
    expect(tree.toSnapshot().version).toBe(4)
  })

  it('should reject corrupted snapshot where rootId does not match actual root (ROOT_ID_MISMATCH)', () => {
    const corrupted: ConversationTreeSnapshot = {
      ...validSnapshot,
      rootId: 'wrong-root-id'
    }

    const res = ConversationTree.hydrate(corrupted)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('ROOT_ID_MISMATCH')
    }
  })

  it('should reject snapshot with cyclic dependencies (CYCLE_DETECTED)', () => {
    const corrupted: ConversationTreeSnapshot = {
      ...validSnapshot,
      nodes: validSnapshot.nodes.map((n) =>
        n.id === 'root' ? { ...n, parentId: 'u2' } : n
      )
    }

    const res = ConversationTree.hydrate(corrupted)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CYCLE_DETECTED')
    }
  })
})
