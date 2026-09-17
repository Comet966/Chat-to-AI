import { describe, expect, it } from 'vitest'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'

describe('ConversationTreeService - Orchestration and Isolation', () => {
  it('should orchestrate tree creation, appending, forking, and deletion with version checking', async () => {
    const repo = new InMemoryConversationTreeRepository()
    const service = new ConversationTreeService(repo)

    // 1. Create Tree
    const createRes = await service.createTree({
      treeId: 'svc-tree-1',
      root: { id: 'root', role: 'user', content: 'Initial message' }
    })
    expect(createRes.ok).toBe(true)
    if (!createRes.ok) return
    expect(createRes.value.version).toBe(1)

    // 2. Append node with expectedVersion 1
    const appendRes = await service.appendNode({
      treeId: 'svc-tree-1',
      expectedVersion: 1,
      parentId: 'root',
      node: { id: 'a1', role: 'assistant', content: 'Response 1' }
    })
    expect(appendRes.ok).toBe(true)
    if (!appendRes.ok) return
    expect(appendRes.value.version).toBe(2)

    // 3. Stale version rejection
    const staleAppend = await service.appendNode({
      treeId: 'svc-tree-1',
      expectedVersion: 1, // Stale!
      parentId: 'a1',
      node: { id: 'u2', role: 'user', content: 'Stale' }
    })
    expect(staleAppend.ok).toBe(false)
    if (!staleAppend.ok) {
      expect(staleAppend.error.code).toBe('VERSION_CONFLICT')
    }

    // 4. Fork from historical root with expectedVersion 2
    const forkRes = await service.forkFromNode({
      treeId: 'svc-tree-1',
      expectedVersion: 2,
      parentId: 'root',
      node: { id: 'a2', role: 'assistant', content: 'Alternative response' }
    })
    expect(forkRes.ok).toBe(true)
    if (!forkRes.ok) return
    expect(forkRes.value.version).toBe(3)

    // 5. Query service methods
    const leavesRes = await service.listLeaves('svc-tree-1')
    expect(leavesRes.ok).toBe(true)
    if (leavesRes.ok) {
      expect(leavesRes.value.map((l) => l.id)).toEqual(['a1', 'a2'])
    }

    const branchesRes = await service.listBranches('svc-tree-1')
    expect(branchesRes.ok).toBe(true)
    if (branchesRes.ok) {
      expect(branchesRes.value).toHaveLength(2)
    }

    const pathRes = await service.getPathToNode('svc-tree-1', 'a2')
    expect(pathRes.ok).toBe(true)
    if (pathRes.ok) {
      expect(pathRes.value.map((n) => n.id)).toEqual(['root', 'a2'])
    }

    // 6. Delete a branch leaf with expectedVersion 3
    const delRes = await service.deleteNode({
      treeId: 'svc-tree-1',
      expectedVersion: 3,
      nodeId: 'a2'
    })
    expect(delRes.ok).toBe(true)
    if (!delRes.ok) return
    expect(delRes.value.newVersion).toBe(4)

    // 7. Delete entire tree with expectedVersion 4
    const delTreeRes = await service.deleteTree({
      treeId: 'svc-tree-1',
      expectedVersion: 4
    })
    expect(delTreeRes.ok).toBe(true)

    // Tree no longer exists in repository
    const getAfterDel = await service.getTree('svc-tree-1')
    expect(getAfterDel.ok).toBe(false)
  })

  it('should maintain strict isolation between multiple conversation trees', async () => {
    const repo = new InMemoryConversationTreeRepository()
    const service = new ConversationTreeService(repo)

    await service.createTree({
      treeId: 'tree-alpha',
      root: { id: 'alpha-root', role: 'user', content: 'Alpha root' }
    })

    await service.createTree({
      treeId: 'tree-beta',
      root: { id: 'beta-root', role: 'user', content: 'Beta root' }
    })

    // Try to append across trees (parent in Alpha, treeId is Beta)
    const crossRes = await service.appendNode({
      treeId: 'tree-beta',
      expectedVersion: 1,
      parentId: 'alpha-root',
      node: { id: 'cross-node', role: 'assistant', content: 'Cross talk' }
    })

    expect(crossRes.ok).toBe(false)
    if (!crossRes.ok) {
      expect(crossRes.error.code).toBe('PARENT_NOT_FOUND')
    }

    const treesList = await service.listTrees()
    expect(treesList.ok).toBe(true)
    if (treesList.ok) {
      expect(treesList.value.map((t) => t.treeId)).toEqual(['tree-alpha', 'tree-beta'])
    }
  })
})
