import { describe, expect, it } from 'vitest'
import type { ConversationTreeSnapshot } from 'chat-conversation-tree'
import { projectConversationTurns } from '../../apps/desktop/src/main/conversation/conversation-turn.projector.js'

describe('projectConversationTurns', () => {
  it('projects message nodes into complete question and answer turns', () => {
    const tree: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: 'tree-1',
      rootId: 'u1',
      version: 4,
      nextSequence: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:03:00.000Z',
      nodes: [
        {
          id: 'u1', treeId: 'tree-1', parentId: null, role: 'user', content: 'Q1',
          sequence: 0, createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'a1', treeId: 'tree-1', parentId: 'u1', role: 'assistant', content: 'A1',
          sequence: 1, createdAt: '2026-01-01T00:01:00.000Z',
          generatedBy: { providerId: 'anthropic', modelId: 'claude-test' }
        },
        {
          id: 'u2', treeId: 'tree-1', parentId: 'a1', role: 'user', content: 'Q2',
          sequence: 2, createdAt: '2026-01-01T00:02:00.000Z'
        },
        {
          id: 'a2', treeId: 'tree-1', parentId: 'u2', role: 'assistant', content: 'A2',
          sequence: 3, createdAt: '2026-01-01T00:03:00.000Z'
        }
      ]
    }

    const projected = projectConversationTurns(tree, 'a2')
    expect(projected.ok).toBe(true)
    if (!projected.ok) return
    expect(projected.value.snapshot).toMatchObject({
      treeId: 'tree-1',
      revision: 4,
      rootTurnId: 'a1',
      currentTurnId: 'a2'
    })
    expect(projected.value.snapshot.turns).toEqual([
      {
        id: 'a1', parentId: null, question: 'Q1', answer: 'A1', sequence: 0,
        createdAt: '2026-01-01T00:01:00.000Z',
        providerInfo: { provider: 'anthropic', modelId: 'claude-test' }
      },
      {
        id: 'a2', parentId: 'a1', question: 'Q2', answer: 'A2', sequence: 1,
        createdAt: '2026-01-01T00:03:00.000Z'
      }
    ])
  })

  it('hides an incomplete user message and resolves current to its parent turn', () => {
    const tree: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: 'tree-pending',
      rootId: 'u1',
      version: 3,
      nextSequence: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
      nodes: [
        {
          id: 'u1', treeId: 'tree-pending', parentId: null, role: 'user', content: 'Q1',
          sequence: 0, createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'a1', treeId: 'tree-pending', parentId: 'u1', role: 'assistant', content: 'A1',
          sequence: 1, createdAt: '2026-01-01T00:01:00.000Z'
        },
        {
          id: 'u2', treeId: 'tree-pending', parentId: 'a1', role: 'user', content: 'pending',
          sequence: 2, createdAt: '2026-01-01T00:02:00.000Z'
        }
      ]
    }

    const projected = projectConversationTurns(tree, 'u2')
    expect(projected.ok).toBe(true)
    if (!projected.ok) return
    expect(projected.value.snapshot.turns).toHaveLength(1)
    expect(projected.value.snapshot.currentTurnId).toBe('a1')
  })
})
