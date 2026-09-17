import { describe, expect, it } from 'vitest'
import {
  TreeInvariantGuard,
  type ConversationTreeSnapshot
} from 'chat-conversation-tree'

function makeValidSnapshot(): ConversationTreeSnapshot {
  return {
    schemaVersion: 1,
    treeId: 'tree-1',
    rootId: 'root',
    version: 1,
    nextSequence: 3,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    nodes: [
      {
        id: 'root',
        treeId: 'tree-1',
        parentId: null,
        role: 'user',
        content: 'Root',
        sequence: 0,
        createdAt: '2026-09-16T10:00:00.000Z'
      },
      {
        id: 'child-1',
        treeId: 'tree-1',
        parentId: 'root',
        role: 'assistant',
        content: 'Reply',
        sequence: 1,
        createdAt: '2026-09-16T10:00:01.000Z'
      },
      {
        id: 'child-2',
        treeId: 'tree-1',
        parentId: 'child-1',
        role: 'user',
        content: 'Follow-up',
        sequence: 2,
        createdAt: '2026-09-16T10:00:02.000Z'
      }
    ]
  }
}

describe('TreeInvariantGuard - Invariants and Cycles', () => {
  it('should accept a completely valid tree snapshot', () => {
    const res = TreeInvariantGuard.validateSnapshot(makeValidSnapshot())
    expect(res.ok).toBe(true)
  })

  it('should detect self-cycle (A.parentId = A)', () => {
    const snapshot = makeValidSnapshot()
    snapshot.nodes = [
      ...snapshot.nodes,
      {
        id: 'cycle-node',
        treeId: 'tree-1',
        parentId: 'cycle-node',
        role: 'user',
        content: 'Self loop',
        sequence: 4,
        createdAt: '2026-09-16T10:00:04.000Z'
      }
    ]
    snapshot.nextSequence = 5

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CYCLE_DETECTED')
    }
  })

  it('should detect two-node cycle (A.parentId = B, B.parentId = A)', () => {
    const snapshot: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: 'tree-1',
      rootId: 'A',
      version: 1,
      nextSequence: 3,
      createdAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      nodes: [
        {
          id: 'A',
          treeId: 'tree-1',
          parentId: 'B',
          role: 'user',
          content: 'Node A',
          sequence: 0,
          createdAt: '2026-09-16T10:00:00.000Z'
        },
        {
          id: 'B',
          treeId: 'tree-1',
          parentId: 'A',
          role: 'assistant',
          content: 'Node B',
          sequence: 1,
          createdAt: '2026-09-16T10:00:01.000Z'
        }
      ]
    }

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CYCLE_DETECTED')
    }
  })

  it('should detect deeper cycle (A -> B -> C -> B)', () => {
    const snapshot: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: 'tree-1',
      rootId: 'root',
      version: 1,
      nextSequence: 4,
      createdAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      nodes: [
        {
          id: 'root',
          treeId: 'tree-1',
          parentId: null,
          role: 'user',
          content: 'Root',
          sequence: 0,
          createdAt: '2026-09-16T10:00:00.000Z'
        },
        {
          id: 'B',
          treeId: 'tree-1',
          parentId: 'C',
          role: 'assistant',
          content: 'Node B',
          sequence: 1,
          createdAt: '2026-09-16T10:00:01.000Z'
        },
        {
          id: 'C',
          treeId: 'tree-1',
          parentId: 'B',
          role: 'user',
          content: 'Node C',
          sequence: 2,
          createdAt: '2026-09-16T10:00:02.000Z'
        }
      ]
    }

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CYCLE_DETECTED')
    }
  })

  it('should reject multiple roots (INVALID_ROOT_COUNT)', () => {
    const snapshot = makeValidSnapshot()
    snapshot.nodes = [
      ...snapshot.nodes,
      {
        id: 'second-root',
        treeId: 'tree-1',
        parentId: null,
        role: 'user',
        content: 'Another root',
        sequence: 3,
        createdAt: '2026-09-16T10:00:03.000Z'
      }
    ]
    snapshot.nextSequence = 4

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_ROOT_COUNT')
    }
  })

  it('should reject when parent node is missing (PARENT_NOT_FOUND)', () => {
    const snapshot = makeValidSnapshot()
    snapshot.nodes = [
      ...snapshot.nodes,
      {
        id: 'orphan',
        treeId: 'tree-1',
        parentId: 'non-existent-parent',
        role: 'user',
        content: 'Orphan content',
        sequence: 3,
        createdAt: '2026-09-16T10:00:03.000Z'
      }
    ]
    snapshot.nextSequence = 4

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('PARENT_NOT_FOUND')
    }
  })

  it('should prevent all representable disconnected components', () => {
    // A finite graph with one parent pointer per node cannot contain a component
    // disconnected from the sole root without introducing a second root or a cycle.
    const secondRoot = makeValidSnapshot()
    secondRoot.nodes = [
      ...secondRoot.nodes,
      {
        id: 'detached-root',
        treeId: 'tree-1',
        parentId: null,
        role: 'user',
        content: 'Detached root',
        sequence: 3,
        createdAt: '2026-09-16T10:00:03.000Z'
      }
    ]
    secondRoot.nextSequence = 4

    const secondRootResult = TreeInvariantGuard.validateSnapshot(secondRoot)
    expect(secondRootResult.ok).toBe(false)
    if (!secondRootResult.ok) {
      expect(secondRootResult.error.code).toBe('INVALID_ROOT_COUNT')
    }

    const detachedCycle = makeValidSnapshot()
    detachedCycle.nodes = [
      detachedCycle.nodes[0],
      {
        id: 'detached-a',
        treeId: 'tree-1',
        parentId: 'detached-b',
        role: 'user',
        content: 'Detached A',
        sequence: 1,
        createdAt: '2026-09-16T10:00:01.000Z'
      },
      {
        id: 'detached-b',
        treeId: 'tree-1',
        parentId: 'detached-a',
        role: 'assistant',
        content: 'Detached B',
        sequence: 2,
        createdAt: '2026-09-16T10:00:02.000Z'
      }
    ]

    const detachedCycleResult = TreeInvariantGuard.validateSnapshot(detachedCycle)
    expect(detachedCycleResult.ok).toBe(false)
    if (!detachedCycleResult.ok) {
      expect(detachedCycleResult.error.code).toBe('CYCLE_DETECTED')
    }
  })

  it('should reject a snapshot with zero roots', () => {
    const snapshot = makeValidSnapshot()
    snapshot.nodes = []

    const result = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ROOT_COUNT')
    }
  })

  it('should reject mismatched treeId on nodes (TREE_ID_MISMATCH)', () => {
    const snapshot = makeValidSnapshot()
    const node = snapshot.nodes[1]
    ;(node as unknown as { treeId: string }).treeId = 'other-tree'

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('TREE_ID_MISMATCH')
    }
  })

  it('should reject duplicate node id (DUPLICATE_NODE_ID)', () => {
    const snapshot = makeValidSnapshot()
    snapshot.nodes = [
      ...snapshot.nodes,
      {
        id: 'child-1', // duplicate
        treeId: 'tree-1',
        parentId: 'root',
        role: 'user',
        content: 'Duplicate ID',
        sequence: 3,
        createdAt: '2026-09-16T10:00:03.000Z'
      }
    ]
    snapshot.nextSequence = 4

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('DUPLICATE_NODE_ID')
    }
  })

  it('should reject duplicate sequence numbers (INVALID_SEQUENCE)', () => {
    const snapshot = makeValidSnapshot()
    const node = snapshot.nodes[2]
    ;(node as unknown as { sequence: number }).sequence = 1 // Duplicate of child-1

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_SEQUENCE')
    }
  })

  it('should reject when parent sequence >= child sequence (INVALID_SEQUENCE)', () => {
    const snapshot = makeValidSnapshot()
    const parent = snapshot.nodes[0]
    const child = snapshot.nodes[1]
    ;(parent as unknown as { sequence: number }).sequence = 10
    ;(child as unknown as { sequence: number }).sequence = 5

    const res = TreeInvariantGuard.validateSnapshot(snapshot)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_SEQUENCE')
    }
  })
})
