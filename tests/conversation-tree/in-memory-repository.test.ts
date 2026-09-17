import { describe, expect, it } from 'vitest'
import {
  ConversationTree,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'

describe('InMemoryConversationTreeRepository', () => {
  it('should reject create if treeId already exists', async () => {
    const repo = new InMemoryConversationTreeRepository()
    const tree = ConversationTree.create({
      treeId: 'repo-tree-1',
      root: { id: 'root', role: 'user', content: 'Root' }
    }).value!

    const res1 = await repo.create(tree.toSnapshot())
    expect(res1.ok).toBe(true)

    const res2 = await repo.create(tree.toSnapshot())
    expect(res2.ok).toBe(false)
    if (!res2.ok) {
      expect(res2.error.code).toBe('TREE_ALREADY_EXISTS')
    }
  })

  it('should prevent concurrent overwrites with VERSION_CONFLICT (optimistic concurrency)', async () => {
    const repo = new InMemoryConversationTreeRepository()
    const tree = ConversationTree.create({
      treeId: 'repo-tree-2',
      root: { id: 'root', role: 'user', content: 'Root' }
    }).value!

    await repo.create(tree.toSnapshot())

    // Two concurrent mutations starting from version 1
    const snapshotV1 = (await repo.load('repo-tree-2')).value!
    const treeA = ConversationTree.hydrate(snapshotV1).value!
    const treeB = ConversationTree.hydrate(snapshotV1).value!

    treeA.appendNode({ parentId: 'root', node: { id: 'a', role: 'assistant', content: 'From A' } })
    treeB.appendNode({ parentId: 'root', node: { id: 'b', role: 'assistant', content: 'From B' } })

    // A saves with expectedVersion 1 -> success
    const saveARes = await repo.save(treeA.toSnapshot(), 1)
    expect(saveARes.ok).toBe(true)

    // B tries to save with expectedVersion 1 -> fails with VERSION_CONFLICT
    const saveBRes = await repo.save(treeB.toSnapshot(), 1)
    expect(saveBRes.ok).toBe(false)
    if (!saveBRes.ok) {
      expect(saveBRes.error.code).toBe('VERSION_CONFLICT')
    }

    // Repository maintains A's snapshot intact
    const loaded = (await repo.load('repo-tree-2')).value!
    expect(loaded.version).toBe(2)
    expect(loaded.nodes.some((n) => n.id === 'a')).toBe(true)
    expect(loaded.nodes.some((n) => n.id === 'b')).toBe(false)
  })

  it('should return deep clones on read and write to prevent reference leaks', async () => {
    const repo = new InMemoryConversationTreeRepository()
    const tree = ConversationTree.create({
      treeId: 'repo-tree-3',
      root: { id: 'root', role: 'user', content: 'Original' }
    }).value!

    const createSnapshot = tree.toSnapshot()
    await repo.create(createSnapshot)
    ;(createSnapshot.nodes[0] as unknown as { content: string }).content = 'MUTATED CREATE INPUT'

    expect((await repo.load('repo-tree-3')).value!.nodes[0].content).toBe('Original')

    const loaded = (await repo.load('repo-tree-3')).value!
    ;(loaded.nodes[0] as unknown as { content: string }).content = 'TAMPERED'

    const loadedAgain = (await repo.load('repo-tree-3')).value!
    expect(loadedAgain.nodes[0].content).toBe('Original')

    const updatedTree = ConversationTree.hydrate(loadedAgain).value!
    updatedTree.appendNode({
      parentId: 'root',
      node: { id: 'a1', role: 'assistant', content: 'Saved response' }
    })
    const saveSnapshot = updatedTree.toSnapshot()
    expect((await repo.save(saveSnapshot, 1)).ok).toBe(true)
    ;(saveSnapshot.nodes[1] as unknown as { content: string }).content = 'MUTATED SAVE INPUT'

    expect((await repo.load('repo-tree-3')).value!.nodes[1].content).toBe('Saved response')
  })

  it('should return stable sorted list of descriptors', async () => {
    const repo = new InMemoryConversationTreeRepository()

    const makeTree = (id: string, time: string) => {
      return ConversationTree.create(
        { treeId: id, root: { id: 'r', role: 'user', content: 'Content' } },
        { now: () => time }
      ).value!.toSnapshot()
    }

    await repo.create(makeTree('tree-z', '2026-09-16T12:00:00.000Z'))
    await repo.create(makeTree('tree-a', '2026-09-16T10:00:00.000Z'))
    await repo.create(makeTree('tree-b', '2026-09-16T10:00:00.000Z'))

    const listRes = await repo.list()
    expect(listRes.ok).toBe(true)
    if (!listRes.ok) return

    expect(listRes.value.map((d) => d.treeId)).toEqual(['tree-a', 'tree-b', 'tree-z'])

    ;(listRes.value[0] as unknown as { nodeCount: number }).nodeCount = 999
    const listAgain = await repo.list()
    expect(listAgain.ok).toBe(true)
    if (listAgain.ok) {
      expect(listAgain.value[0].nodeCount).toBe(1)
    }
  })

  it('should return TREE_NOT_FOUND when loading or deleting non-existent tree', async () => {
    const repo = new InMemoryConversationTreeRepository()

    expect((await repo.load('ghost')).ok).toBe(false)
    expect((await repo.delete('ghost', 1)).ok).toBe(false)
    expect((await repo.save({} as any, 1)).ok).toBe(false)
  })
})
