import { describe, expect, it } from 'vitest'
import { ConversationTree } from 'chat-conversation-tree'

describe('ConversationTree - Node Deletion', () => {
  // Tree topology:
  //         r
  //        / \
  //       a1  a2
  //      / \
  //     u1  u2
  function buildTree(): ConversationTree {
    const tree = ConversationTree.create({
      treeId: 'del-tree',
      root: { id: 'r', role: 'user', content: 'Root' }
    }).value!

    tree.appendNode({ parentId: 'r', node: { id: 'a1', role: 'assistant', content: 'Answer 1' } })
    tree.appendNode({ parentId: 'r', node: { id: 'a2', role: 'assistant', content: 'Answer 2' } })
    tree.appendNode({ parentId: 'a1', node: { id: 'u1', role: 'user', content: 'U1' } })
    tree.appendNode({ parentId: 'a1', node: { id: 'u2', role: 'user', content: 'U2' } })

    return tree
  }

  it('should delete a leaf node in default leaf-only mode', () => {
    const tree = buildTree()
    const versionBefore = tree.toSnapshot().version

    const delRes = tree.deleteNode({ nodeId: 'u1' })
    expect(delRes.ok).toBe(true)
    if (!delRes.ok) return

    expect(delRes.value.deletedNodeIds).toEqual(['u1'])
    expect(delRes.value.newVersion).toBe(versionBefore + 1)
    expect(tree.hasNode('u1')).toBe(false)

    // Children of a1 now only u2
    const childrenA1 = tree.getChildren('a1').value!
    expect(childrenA1.map((c) => c.id)).toEqual(['u2'])
  })

  it('should reject deleting a non-leaf node in leaf-only mode with NODE_HAS_CHILDREN', () => {
    const tree = buildTree()
    const versionBefore = tree.toSnapshot().version

    const delRes = tree.deleteNode({ nodeId: 'a1', mode: 'leaf-only' })
    expect(delRes.ok).toBe(false)
    if (!delRes.ok) {
      expect(delRes.error.code).toBe('NODE_HAS_CHILDREN')
    }

    expect(tree.toSnapshot().version).toBe(versionBefore)
    expect(tree.hasNode('a1')).toBe(true)
    expect(tree.hasNode('u1')).toBe(true)
  })

  it('should reject an invalid delete mode without mutating the tree', () => {
    const tree = buildTree()
    const snapshotBefore = tree.toSnapshot()

    const result = tree.deleteNode({
      nodeId: 'a1',
      mode: 'unexpected' as 'leaf-only'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_DELETE_MODE')
    }
    expect(tree.toSnapshot()).toEqual(snapshotBefore)
  })

  it('should delete entire subtree in subtree mode without affecting sibling branches', () => {
    const tree = buildTree()

    const delRes = tree.deleteNode({ nodeId: 'a1', mode: 'subtree' })
    expect(delRes.ok).toBe(true)
    if (!delRes.ok) return

    expect(delRes.value.deletedNodeIds).toEqual(['a1', 'u1', 'u2'])
    expect(tree.hasNode('a1')).toBe(false)
    expect(tree.hasNode('u1')).toBe(false)
    expect(tree.hasNode('u2')).toBe(false)

    // Sibling branch under a2 remains intact
    expect(tree.hasNode('a2')).toBe(true)
    expect(tree.listLeaves().map((l) => l.id)).toEqual(['a2'])
    expect(tree.listBranches()).toEqual([
      { leafNodeId: 'a2', nodeIds: ['r', 'a2'] }
    ])
    expect(tree.toDescriptor()).toMatchObject({
      treeId: 'del-tree',
      rootId: 'r',
      version: 6,
      nodeCount: 2,
      leafCount: 1
    })
  })

  it('should refuse to delete root node in either mode', () => {
    const tree = buildTree()

    const resLeaf = tree.deleteNode({ nodeId: 'r', mode: 'leaf-only' })
    expect(resLeaf.ok).toBe(false)
    if (!resLeaf.ok) {
      expect(resLeaf.error.code).toBe('ROOT_DELETE_REQUIRES_TREE_DELETE')
    }

    const resSub = tree.deleteNode({ nodeId: 'r', mode: 'subtree' })
    expect(resSub.ok).toBe(false)
    if (!resSub.ok) {
      expect(resSub.error.code).toBe('ROOT_DELETE_REQUIRES_TREE_DELETE')
    }
  })

  it('should reject a missing node without changing version or topology', () => {
    const tree = buildTree()
    const snapshotBefore = tree.toSnapshot()

    const result = tree.deleteNode({ nodeId: 'missing-node' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NODE_NOT_FOUND')
    }
    expect(tree.toSnapshot()).toEqual(snapshotBefore)
  })

  it('should preserve nextSequence without reusing deleted sequence numbers', () => {
    const tree = buildTree()
    const seqBefore = tree.toSnapshot().nextSequence

    tree.deleteNode({ nodeId: 'u2' })
    const seqAfterDel = tree.toSnapshot().nextSequence
    expect(seqAfterDel).toBe(seqBefore) // does not decrease

    // Appending a new node should receive seqBefore and not reuse u2's sequence
    const appendRes = tree.appendNode({
      parentId: 'a1',
      node: { id: 'u3', role: 'user', content: 'New message' }
    })
    expect(appendRes.ok).toBe(true)
    if (!appendRes.ok) return
    expect(appendRes.value.sequence).toBe(seqBefore)
    expect(tree.toSnapshot().nextSequence).toBe(seqBefore + 1)
  })
})
