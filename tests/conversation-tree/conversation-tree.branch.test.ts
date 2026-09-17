import { describe, expect, it } from 'vitest'
import { ConversationTree } from 'chat-conversation-tree'

describe('ConversationTree - Branching and Appending', () => {
  it('should append nodes along a linear chain from the root', () => {
    const createRes = ConversationTree.create({
      treeId: 't1',
      root: { id: 'u1', role: 'user', content: 'Prompt 1' }
    })
    expect(createRes.ok).toBe(true)
    if (!createRes.ok) return
    const tree = createRes.value

    const a1 = tree.appendNode({
      parentId: 'u1',
      node: { id: 'a1', role: 'assistant', content: 'Reply 1' }
    })
    expect(a1.ok).toBe(true)

    const u2 = tree.appendNode({
      parentId: 'a1',
      node: { id: 'u2', role: 'user', content: 'Prompt 2' }
    })
    expect(u2.ok).toBe(true)

    const leaves = tree.listLeaves()
    expect(leaves).toHaveLength(1)
    expect(leaves[0].id).toBe('u2')

    const branches = tree.listBranches()
    expect(branches).toHaveLength(1)
    expect(branches[0].leafNodeId).toBe('u2')
    expect(branches[0].nodeIds).toEqual(['u1', 'a1', 'u2'])
  })

  it('should fork from a historical node creating a true branch point', () => {
    const createRes = ConversationTree.create({
      treeId: 't1',
      root: { id: 'u1', role: 'user', content: 'Explain quantum computing' }
    })
    expect(createRes.ok).toBe(true)
    if (!createRes.ok) return
    const tree = createRes.value

    // First child of u1
    const fork1 = tree.forkFromNode({
      parentId: 'u1',
      node: {
        id: 'a1',
        role: 'assistant',
        content: 'Explanation from OpenAI',
        generatedBy: { providerId: 'openai-compatible', modelId: 'gpt-4o' }
      }
    })
    expect(fork1.ok).toBe(true)
    if (!fork1.ok) return
    expect(fork1.value.createdActualFork).toBe(false)
    expect(fork1.value.siblingCountAfterCreate).toBe(1)
    expect(fork1.value.branchPointId).toBe('u1')

    // Second child of u1 (true fork!)
    const fork2 = tree.forkFromNode({
      parentId: 'u1',
      node: {
        id: 'a2',
        role: 'assistant',
        content: 'Explanation from Anthropic',
        generatedBy: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }
      }
    })
    expect(fork2.ok).toBe(true)
    if (!fork2.ok) return
    expect(fork2.value.createdActualFork).toBe(true)
    expect(fork2.value.siblingCountAfterCreate).toBe(2)
    expect(fork2.value.branchPointId).toBe('u1')

    // Third child of u1
    const fork3 = tree.forkFromNode({
      parentId: 'u1',
      node: {
        id: 'a3',
        role: 'assistant',
        content: 'Explanation from Gemini',
        generatedBy: { providerId: 'gemini', modelId: 'gemini-1.5-pro' }
      }
    })
    expect(fork3.ok).toBe(true)
    if (!fork3.ok) return
    expect(fork3.value.createdActualFork).toBe(true)
    expect(fork3.value.siblingCountAfterCreate).toBe(3)

    // Verify children order is strictly sequence ascending
    const childrenRes = tree.getChildren('u1')
    expect(childrenRes.ok).toBe(true)
    if (!childrenRes.ok) return
    expect(childrenRes.value.map((c) => c.id)).toEqual(['a1', 'a2', 'a3'])

    // Verify leaves and branches
    const leaves = tree.listLeaves()
    expect(leaves.map((l) => l.id)).toEqual(['a1', 'a2', 'a3'])

    const branches = tree.listBranches()
    expect(branches).toHaveLength(3)
    expect(branches[0].nodeIds).toEqual(['u1', 'a1'])
    expect(branches[1].nodeIds).toEqual(['u1', 'a2'])
    expect(branches[2].nodeIds).toEqual(['u1', 'a3'])
  })

  it('should reject duplicate nodeId and preserve existing snapshot', () => {
    const tree = ConversationTree.create({
      treeId: 't1',
      root: { id: 'root', role: 'user', content: 'Root' }
    }).value!

    tree.appendNode({
      parentId: 'root',
      node: { id: 'node-1', role: 'assistant', content: 'Content' }
    })
    const snapshotBefore = tree.toSnapshot()

    const dupResult = tree.appendNode({
      parentId: 'root',
      node: { id: 'node-1', role: 'assistant', content: 'Different content' }
    })

    expect(dupResult.ok).toBe(false)
    if (!dupResult.ok) {
      expect(dupResult.error.code).toBe('DUPLICATE_NODE_ID')
    }

    expect(tree.toSnapshot()).toEqual(snapshotBefore)
  })

  it('should reject appending to a non-existent parent', () => {
    const tree = ConversationTree.create({
      treeId: 't1',
      root: { id: 'root', role: 'user', content: 'Root' }
    }).value!

    const res = tree.appendNode({
      parentId: 'ghost-parent',
      node: { id: 'new-node', role: 'assistant', content: 'Content' }
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('PARENT_NOT_FOUND')
    }
  })
})
