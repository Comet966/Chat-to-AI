import { describe, expect, it } from 'vitest'
import type { ConversationTreeSnapshot } from 'chat-conversation-tree'
import { renderConversationTree } from '../../apps/test-cli/src/conversation-tree.renderer.js'

describe('conversation-tree.renderer', () => {
  const sampleSnapshot: ConversationTreeSnapshot = {
    schemaVersion: 1,
    treeId: 'demo-tree',
    rootId: 'u-001',
    version: 7,
    nextSequence: 6,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:05:00.000Z',
    nodes: [
      {
        id: 'u-001',
        treeId: 'demo-tree',
        parentId: null,
        role: 'user',
        content: '解释一下事件循环',
        sequence: 0,
        createdAt: '2026-09-17T00:00:00.000Z'
      },
      {
        id: 'a-001',
        treeId: 'demo-tree',
        parentId: 'u-001',
        role: 'assistant',
        content: '事件循环负责调度异步任务',
        sequence: 1,
        createdAt: '2026-09-17T00:01:00.000Z',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4.1' }
      },
      {
        id: 'u-002',
        treeId: 'demo-tree',
        parentId: 'a-001',
        role: 'user',
        content: '换一个例子',
        sequence: 2,
        createdAt: '2026-09-17T00:02:00.000Z'
      },
      {
        id: 'a-002',
        treeId: 'demo-tree',
        parentId: 'u-002',
        role: 'assistant',
        content: '可以把它想成一个消息队列',
        sequence: 3,
        createdAt: '2026-09-17T00:03:00.000Z',
        generatedBy: { providerId: 'anthropic', modelId: 'claude-sonnet' }
      },
      {
        id: 'a-003',
        treeId: 'demo-tree',
        parentId: 'u-001',
        role: 'assistant',
        content: '从调度角度看它是一个死循环',
        sequence: 4,
        createdAt: '2026-09-17T00:04:00.000Z',
        generatedBy: { providerId: 'gemini', modelId: 'gemini-pro' }
      }
    ]
  }

  it('should render correct ASCII tree topology without ANSI when color is false', () => {
    const rendered = renderConversationTree(sampleSnapshot, 'a-002', {
      contentWidth: 40,
      color: false
    })

    expect(rendered).not.toContain('\x1b[')
    expect(rendered).toContain('tree demo-tree  version=7  nodes=5')
    expect(rendered).toContain('└─ [U] u-001  "解释一下事件循环"')
    expect(rendered).toContain('   ├─ [A] a-001  openai-compatible/gpt-4.1  "事件循环负责调度异步任务"')
    expect(rendered).toContain('   │  └─ [U] u-002  "换一个例子"')
    expect(rendered).toContain('   │     └─ [A]* a-002  anthropic/claude-sonnet  "可以把它想成一个消息队列"')
    expect(rendered).toContain('   └─ [A] a-003  gemini/gemini-pro  "从调度角度看它是一个死循环"')
    expect(rendered).toContain('* = current')
  })

  it('should mark current node uniquely with *', () => {
    const rendered = renderConversationTree(sampleSnapshot, 'u-001', {
      color: false
    })

    expect(rendered).toContain('[U]* u-001')
    expect(rendered).not.toContain('[A]*')
  })

  it('should collapse newlines and truncate content exceeding contentWidth', () => {
    const snapshotWithLongContent: ConversationTreeSnapshot = {
      ...sampleSnapshot,
      nodes: [
        {
          id: 'u-long',
          treeId: 'demo-tree',
          parentId: null,
          role: 'user',
          content: 'Line 1\n  Line 2   with   spaces   and   long   trail   of   words   exceeding   limit',
          sequence: 0,
          createdAt: '2026-09-17T00:00:00.000Z'
        }
      ]
    }

    const rendered = renderConversationTree(snapshotWithLongContent, 'u-long', {
      contentWidth: 20,
      color: false
    })

    expect(rendered).not.toContain('\n  Line 2')
    expect(rendered).toContain('Line 1 Line 2 with s...')
  })

  it('should handle empty tree snapshot gracefully', () => {
    const empty: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: 'empty',
      rootId: '',
      version: 0,
      nextSequence: 0,
      createdAt: '',
      updatedAt: '',
      nodes: []
    }

    const rendered = renderConversationTree(empty, '')
    expect(rendered).toBe('Empty tree')
  })
})
