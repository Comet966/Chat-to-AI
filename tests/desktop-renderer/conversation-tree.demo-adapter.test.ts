import { describe, expect, it, vi } from 'vitest'
import {
  DemoConversationTreeUiAdapter,
  DEFAULT_DEMO_TREE_SNAPSHOT
} from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import type { ConversationTreeSnapshot } from '../../apps/desktop/src/renderer/src/ports/conversation-tree-ui.port.js'

describe('DemoConversationTreeUiAdapter', () => {
  it('loads snapshot as a defensive copy', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const result1 = await adapter.getSnapshot()
    expect(result1.ok).toBe(true)
    if (!result1.ok) return

    expect(result1.value.rootId).toBe('node-root')
    expect(result1.value.currentNodeId).toBe('node-a2-b1')
    expect(result1.value.nodes.length).toBe(6)

    // Mutating returned object does not affect internal state
    result1.value.nodes.pop()
    const result2 = await adapter.getSnapshot()
    expect(result2.ok).toBe(true)
    if (!result2.ok) return
    expect(result2.value.nodes.length).toBe(6)
  })

  it('notifies subscribers on state changes and unregisters cleanly', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const listener = vi.fn()
    const unsubscribe = adapter.subscribe(listener)

    await adapter.setCurrentNode('node-a1')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].currentNodeId).toBe('node-a1')

    unsubscribe()
    await adapter.setCurrentNode('node-u1')
    expect(listener).toHaveBeenCalledTimes(1) // Not called again
  })

  it('switches current node to existing node and rejects non-existent node', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const success = await adapter.setCurrentNode('node-u2')
    expect(success.ok).toBe(true)
    if (success.ok) {
      expect(success.value.currentNodeId).toBe('node-u2')
    }

    const failure = await adapter.setCurrentNode('node-non-existent')
    expect(failure.ok).toBe(false)
    if (!failure.ok) {
      expect(failure.error.code).toBe('NODE_NOT_FOUND')
      expect(failure.error.nodeId).toBe('node-non-existent')
    }

    // Original snapshot still intact
    const current = await adapter.getSnapshot()
    expect(current.ok && current.value.currentNodeId).toBe('node-u2')
  })

  it('adds child node to parent and sets as current node', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const addResult = await adapter.addChildNode({
      parentId: 'node-a2-b2',
      question: 'Can you show concrete code for Strategy B?',
      answer: 'Yes. Here is a concise example.'
    })

    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    const newNode = addResult.value.nodes.find((n) => n.id === addResult.value.currentNodeId)
    expect(newNode).toBeDefined()
    expect(newNode?.parentId).toBe('node-a2-b2')
    expect(newNode?.question).toBe('Can you show concrete code for Strategy B?')
    expect(newNode?.answer).toBe('Yes. Here is a concise example.')
    expect(addResult.value.revision).toBe(DEFAULT_DEMO_TREE_SNAPSHOT.revision + 1)
  })

  it('rejects adding an incomplete turn or using a non-existent parent', async () => {
    const adapter = new DemoConversationTreeUiAdapter()

    const emptyContent = await adapter.addChildNode({
      parentId: 'node-u1',
      question: 'A valid question',
      answer: '   '
    })
    expect(emptyContent.ok).toBe(false)
    if (!emptyContent.ok) {
      expect(emptyContent.error.code).toBe('VALIDATION_FAILED')
    }

    const missingParent = await adapter.addChildNode({
      parentId: 'node-ghost',
      question: 'hello',
      answer: 'world'
    })
    expect(missingParent.ok).toBe(false)
    if (!missingParent.ok) {
      expect(missingParent.error.code).toBe('NODE_NOT_FOUND')
    }
  })

  it('protects root node from deletion', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const deleteRoot = await adapter.deleteNodes({ nodeIds: ['node-root'], mode: 'subtree' })

    expect(deleteRoot.ok).toBe(false)
    if (!deleteRoot.ok) {
      expect(deleteRoot.error.code).toBe('ROOT_NODE_PROTECTED')
    }

    // Tree nodes remain unchanged
    const snap = await adapter.getSnapshot()
    expect(snap.ok && snap.value.nodes.length).toBe(6)
  })

  it('deletes leaf node and its siblings remain untouched', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const res = await adapter.deleteNodes({ nodeIds: ['node-a2-b2'], mode: 'leaf-only' })

    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.value.nodes.find((n) => n.id === 'node-a2-b2')).toBeUndefined()
    expect(res.value.nodes.find((n) => n.id === 'node-a2-b1')).toBeDefined()
    expect(res.value.nodes.length).toBe(5)
  })

  it('deletes interior node along with all its descendants (subtree deletion) and shifts current node', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    // Current node is node-a2-b1. Deleting node-u2 will delete node-u2, node-a2-b1, and node-a2-b2!
    const res = await adapter.deleteNodes({ nodeIds: ['node-u2'], mode: 'subtree' })

    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.value.nodes.find((n) => n.id === 'node-u2')).toBeUndefined()
    expect(res.value.nodes.find((n) => n.id === 'node-a2-b1')).toBeUndefined()
    expect(res.value.nodes.find((n) => n.id === 'node-a2-b2')).toBeUndefined()
    expect(res.value.nodes.length).toBe(3) // root, u1, a1

    // Current node must have shifted to parent of node-u2 (which is node-a1)
    expect(res.value.currentNodeId).toBe('node-a1')
  })

  it('normalizes multi-selection containing both ancestor and descendant', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    // Select both ancestor node-u2 and descendant node-a2-b1
    const res = await adapter.deleteNodes({ nodeIds: ['node-u2', 'node-a2-b1'], mode: 'subtree' })

    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.value.nodes.length).toBe(3)
    expect(res.value.currentNodeId).toBe('node-a1')
  })

  it('rejects non-leaf nodes in leaf-only mode without changing the snapshot', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const res = await adapter.deleteNodes({ nodeIds: ['node-u2'], mode: 'leaf-only' })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION_FAILED')
      expect(res.error.nodeId).toBe('node-u2')
    }

    const snapshot = await adapter.getSnapshot()
    expect(snapshot.ok && snapshot.value.nodes).toHaveLength(6)
  })

  it('requires a valid explicit delete mode at runtime', async () => {
    const adapter = new DemoConversationTreeUiAdapter()
    const res = await adapter.deleteNodes({
      nodeIds: ['node-a2-b2'],
      mode: 'invalid-mode' as never
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('VALIDATION_FAILED')
  })
})
