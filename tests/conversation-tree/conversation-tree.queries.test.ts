import { describe, expect, it } from 'vitest'
import { ConversationTree } from 'chat-conversation-tree'

describe('ConversationTree - Queries and Paths', () => {
  // Tree topology:
  //         r
  //        / \
  //       a1  a2
  //      / \
  //     u1  u2
  function createSampleTree(): ConversationTree {
    const tree = ConversationTree.create({
      treeId: 'tree-q',
      root: { id: 'r', role: 'user', content: 'Root question' }
    }).value!

    tree.appendNode({ parentId: 'r', node: { id: 'a1', role: 'assistant', content: 'Answer 1' } })
    tree.appendNode({ parentId: 'r', node: { id: 'a2', role: 'assistant', content: 'Answer 2' } })
    tree.appendNode({ parentId: 'a1', node: { id: 'u1', role: 'user', content: 'Follow-up 1' } })
    tree.appendNode({ parentId: 'a1', node: { id: 'u2', role: 'user', content: 'Follow-up 2' } })

    return tree
  }

  it('should return correct path from root to target node in sequence ascending order', () => {
    const tree = createSampleTree()

    const pathRoot = tree.getPathToNode('r')
    expect(pathRoot.ok).toBe(true)
    if (pathRoot.ok) {
      expect(pathRoot.value.map((n) => n.id)).toEqual(['r'])
    }

    const pathMid = tree.getPathToNode('a1')
    expect(pathMid.ok).toBe(true)
    if (pathMid.ok) {
      expect(pathMid.value.map((n) => n.id)).toEqual(['r', 'a1'])
    }

    const pathLeaf = tree.getPathToNode('u1')
    expect(pathLeaf.ok).toBe(true)
    if (pathLeaf.ok) {
      expect(pathLeaf.value.map((n) => n.id)).toEqual(['r', 'a1', 'u1'])
    }
  })

  it('should return correct ancestors in root-first sequence ascending order', () => {
    const tree = createSampleTree()

    const ancRoot = tree.getAncestors('r')
    expect(ancRoot.ok).toBe(true)
    if (ancRoot.ok) {
      expect(ancRoot.value).toEqual([])
    }

    const ancLeaf = tree.getAncestors('u1')
    expect(ancLeaf.ok).toBe(true)
    if (ancLeaf.ok) {
      expect(ancLeaf.value.map((n) => n.id)).toEqual(['r', 'a1'])
    }
  })

  it('should return correct children and descendants', () => {
    const tree = createSampleTree()

    const childrenA1 = tree.getChildren('a1')
    expect(childrenA1.ok).toBe(true)
    if (childrenA1.ok) {
      expect(childrenA1.value.map((n) => n.id)).toEqual(['u1', 'u2'])
    }

    const descR = tree.getDescendants('r')
    expect(descR.ok).toBe(true)
    if (descR.ok) {
      expect(descR.value.map((n) => n.id)).toEqual(['a1', 'a2', 'u1', 'u2'])
    }
  })

  it('should correctly list leaves and branches', () => {
    const tree = createSampleTree()

    const leaves = tree.listLeaves()
    expect(leaves.map((l) => l.id)).toEqual(['a2', 'u1', 'u2'])

    const branches = tree.listBranches()
    expect(branches).toHaveLength(3)
    expect(branches[0]).toEqual({ leafNodeId: 'a2', nodeIds: ['r', 'a2'] })
    expect(branches[1]).toEqual({ leafNodeId: 'u1', nodeIds: ['r', 'a1', 'u1'] })
    expect(branches[2]).toEqual({ leafNodeId: 'u2', nodeIds: ['r', 'a1', 'u2'] })
  })

  it('should return NODE_NOT_FOUND when querying a non-existent node', () => {
    const tree = createSampleTree()

    expect(tree.getNode('ghost').ok).toBe(false)
    expect(tree.getChildren('ghost').ok).toBe(false)
    expect(tree.getAncestors('ghost').ok).toBe(false)
    expect(tree.getPathToNode('ghost').ok).toBe(false)
    expect(tree.getDescendants('ghost').ok).toBe(false)
  })

  it('should prevent leakage when returned nodes/arrays are mutated by caller', () => {
    const tree = createSampleTree()
    const nodeRes = tree.getNode('a1')
    expect(nodeRes.ok).toBe(true)
    if (!nodeRes.ok) return

    // Mutate returned object
    ;(nodeRes.value as unknown as { content: string }).content = 'MUTATED!'

    // Internal snapshot must remain untouched
    const freshNode = tree.getNode('a1').value!
    expect(freshNode.content).toBe('Answer 1')

    const children = tree.getChildren('a1').value!
    ;(children as unknown as Array<{ content: string }>)[0].content = 'MUTATED CHILD!'
    expect(tree.getChildren('a1').value![0].content).toBe('Follow-up 1')

    const branches = tree.listBranches()
    ;(branches[0].nodeIds as string[]).push('MUTATED-BRANCH')
    expect(tree.listBranches()[0].nodeIds).toEqual(['r', 'a2'])

    const snapshot = tree.toSnapshot()
    ;(snapshot.nodes as Array<{ content: string }>)[0].content = 'MUTATED SNAPSHOT!'
    expect(tree.toSnapshot().nodes[0].content).toBe('Root question')
  })
})
