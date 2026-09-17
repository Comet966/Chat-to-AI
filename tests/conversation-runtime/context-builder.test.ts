import { describe, expect, it } from 'vitest'
import type { ConversationNode } from 'chat-conversation-tree'
import { buildChatContext } from '../../packages/conversation-runtime/src/context-builder.js'

describe('context-builder', () => {
  it('should reject empty path', () => {
    const res = buildChatContext([])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_PROMPT')
    }
  })

  it('should reject path whose last node is not user role', () => {
    const path: ConversationNode[] = [
      {
        id: 'u1',
        treeId: 't1',
        parentId: null,
        role: 'user',
        content: 'Hi',
        sequence: 0,
        createdAt: '2026-09-17T00:00:00.000Z'
      },
      {
        id: 'a1',
        treeId: 't1',
        parentId: 'u1',
        role: 'assistant',
        content: 'Hello',
        sequence: 1,
        createdAt: '2026-09-17T00:00:01.000Z'
      }
    ]

    const res = buildChatContext(path)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_PROMPT')
      expect(res.error.message).toContain('must be a user message')
    }
  })

  it('should reject path with blank last user message', () => {
    const path: ConversationNode[] = [
      {
        id: 'u1',
        treeId: 't1',
        parentId: null,
        role: 'user',
        content: '   ',
        sequence: 0,
        createdAt: '2026-09-17T00:00:00.000Z'
      }
    ]

    const res = buildChatContext(path)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_PROMPT')
    }
  })

  it('should reject path exceeding maximum message count', () => {
    const nodes: ConversationNode[] = []
    for (let i = 0; i < 101; i++) {
      nodes.push({
        id: `node-${i}`,
        treeId: 't1',
        parentId: i === 0 ? null : `node-${i - 1}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Msg ${i}`,
        sequence: i,
        createdAt: '2026-09-17T00:00:00.000Z'
      })
    }

    const res = buildChatContext(nodes)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CONTEXT_LIMIT_EXCEEDED')
    }
  })

  it('should reject node exceeding single message length limit', () => {
    const path: ConversationNode[] = [
      {
        id: 'u1',
        treeId: 't1',
        parentId: null,
        role: 'user',
        content: 'x'.repeat(32001),
        sequence: 0,
        createdAt: '2026-09-17T00:00:00.000Z'
      }
    ]

    const res = buildChatContext(path)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CONTEXT_LIMIT_EXCEEDED')
    }
  })

  it('should map valid path to ChatMessageInput array retaining root-first order and stripping node metadata', () => {
    const path: ConversationNode[] = [
      {
        id: 'u1',
        treeId: 't1',
        parentId: null,
        role: 'user',
        content: 'First user prompt',
        sequence: 0,
        createdAt: '2026-09-17T00:00:00.000Z'
      },
      {
        id: 'a1',
        treeId: 't1',
        parentId: 'u1',
        role: 'assistant',
        content: 'First assistant reply',
        sequence: 1,
        createdAt: '2026-09-17T00:00:01.000Z',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4o' }
      },
      {
        id: 'u2',
        treeId: 't1',
        parentId: 'a1',
        role: 'user',
        content: 'Second user prompt',
        sequence: 2,
        createdAt: '2026-09-17T00:00:02.000Z'
      }
    ]

    const res = buildChatContext(path)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual([
        { role: 'user', content: 'First user prompt' },
        { role: 'assistant', content: 'First assistant reply' },
        { role: 'user', content: 'Second user prompt' }
      ])
    }
  })
})
