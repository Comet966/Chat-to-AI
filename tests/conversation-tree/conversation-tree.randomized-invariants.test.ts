import { describe, expect, it } from 'vitest'
import {
  ConversationTree,
  type ConversationNodeRole,
  type ConversationRole
} from 'chat-conversation-tree'

// Deterministic 32-bit PRNG for reproducibility
function createPrng(seed: number) {
  let s = seed >>> 0
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('ConversationTree - Randomized Stress Invariants (500 iterations)', () => {
  const SEED = 20260916
  const prng = createPrng(SEED)

  it(`maintains strict tree invariants across 500 random operations [seed: ${SEED}]`, () => {
    const createRes = ConversationTree.create({
      treeId: 'stress-tree',
      root: { id: 'root', role: 'user', content: 'Genesis' }
    })
    expect(createRes.ok).toBe(true)
    if (!createRes.ok) return

    const tree = createRes.value
    let nodeCounter = 1
    const successfulOperations = {
      append: 0,
      fork: 0,
      leafDelete: 0,
      subtreeDelete: 0
    }

    const roles: ConversationRole[] = ['user', 'assistant']

    for (let step = 0; step < 500; step++) {
      const snapshot = tree.toSnapshot()
      const existingNodeIds = snapshot.nodes.map((n) => n.id)
      const leaves = tree.listLeaves()

      // Roll action:
      // 0..0.4: append
      // 0.4..0.7: fork
      // 0.7..0.85: delete leaf (if > 1 node)
      // 0.85..1.0: delete subtree (if > 1 node)
      const actionRoll = prng()

      try {
        if (actionRoll < 0.4) {
          // Append
          const randomParentId = existingNodeIds[Math.floor(prng() * existingNodeIds.length)]
          const role = roles[Math.floor(prng() * roles.length)]
          const newId = `node-${nodeCounter++}`

          const res = tree.appendNode({
            parentId: randomParentId,
            node: {
              id: newId,
              role,
              content: `Content for ${newId}`,
              ...(role === 'assistant'
                ? { generatedBy: { providerId: 'test-prov', modelId: 'test-mod' } }
                : {})
            }
          })
          expect(res.ok, `Step ${step}: Append failed with error ${JSON.stringify(res)}`).toBe(true)
          if (res.ok) successfulOperations.append++
        } else if (actionRoll < 0.7) {
          // Fork
          const randomParentId = existingNodeIds[Math.floor(prng() * existingNodeIds.length)]
          const role = roles[Math.floor(prng() * roles.length)]
          const newId = `node-${nodeCounter++}`

          const res = tree.forkFromNode({
            parentId: randomParentId,
            node: {
              id: newId,
              role,
              content: `Fork content for ${newId}`,
              ...(role === 'assistant'
                ? { generatedBy: { providerId: 'test-prov', modelId: 'test-mod' } }
                : {})
            }
          })
          expect(res.ok, `Step ${step}: Fork failed with error ${JSON.stringify(res)}`).toBe(true)
          if (res.ok) successfulOperations.fork++
        } else if (actionRoll < 0.85 && existingNodeIds.length > 1) {
          // Delete leaf
          const randomLeaf = leaves[Math.floor(prng() * leaves.length)]
          if (randomLeaf.id !== snapshot.rootId) {
            const res = tree.deleteNode({ nodeId: randomLeaf.id, mode: 'leaf-only' })
            expect(res.ok, `Step ${step}: Delete leaf failed with error ${JSON.stringify(res)}`).toBe(true)
            if (res.ok) successfulOperations.leafDelete++
          }
        } else if (existingNodeIds.length > 1) {
          // Delete subtree (pick non-root)
          const nonRootIds = existingNodeIds.filter((id) => id !== snapshot.rootId)
          if (nonRootIds.length > 0) {
            const randomTargetId = nonRootIds[Math.floor(prng() * nonRootIds.length)]
            const res = tree.deleteNode({ nodeId: randomTargetId, mode: 'subtree' })
            expect(res.ok, `Step ${step}: Delete subtree failed with error ${JSON.stringify(res)}`).toBe(true)
            if (res.ok) successfulOperations.subtreeDelete++
          }
        }

        // Post-operation invariant assertions on current tree
        const postSnapshot = tree.toSnapshot()

        // Invariant 1: validate() must succeed
        const validation = tree.validate()
        expect(validation.ok, `Step ${step} failed invariant validation [seed: ${SEED}]`).toBe(true)

        // Invariant 2: Round-trip hydration must succeed and match snapshot
        const roundTrip = ConversationTree.hydrate(postSnapshot)
        expect(roundTrip.ok, `Step ${step} hydration failed [seed: ${SEED}]`).toBe(true)
        if (roundTrip.ok) {
          expect(roundTrip.value.toSnapshot()).toEqual(postSnapshot)
        }

        // Invariant 3: Single root
        const roots = postSnapshot.nodes.filter((n) => n.parentId === null)
        expect(roots).toHaveLength(1)
        expect(roots[0].id).toBe(postSnapshot.rootId)

        // Invariant 4: Sequences strictly increasing along every edge
        const nodeMap = new Map(postSnapshot.nodes.map((n) => [n.id, n]))
        for (const n of postSnapshot.nodes) {
          if (n.parentId !== null) {
            const p = nodeMap.get(n.parentId)!
            expect(p.treeId).toBe(postSnapshot.treeId)
            expect(n.treeId).toBe(postSnapshot.treeId)
            expect(p.sequence).toBeLessThan(n.sequence)
          }
        }

        // Invariant 5: Unique sequences and complete reachability from the root.
        expect(new Set(postSnapshot.nodes.map((node) => node.sequence)).size).toBe(
          postSnapshot.nodes.length
        )
        const childrenByParent = new Map<string, string[]>()
        for (const node of postSnapshot.nodes) {
          childrenByParent.set(node.id, [])
        }
        for (const node of postSnapshot.nodes) {
          if (node.parentId !== null) {
            childrenByParent.get(node.parentId)!.push(node.id)
          }
        }
        const reachable = new Set<string>()
        const visit = (nodeId: string): void => {
          reachable.add(nodeId)
          for (const childId of childrenByParent.get(nodeId) ?? []) {
            if (!reachable.has(childId)) visit(childId)
          }
        }
        visit(postSnapshot.rootId)
        expect(reachable.size).toBe(postSnapshot.nodes.length)
      } catch (err) {
        throw new Error(`Randomized test failed at step ${step} with seed ${SEED}: ${String(err)}`)
      }
    }

    expect(successfulOperations.append).toBeGreaterThan(0)
    expect(successfulOperations.fork).toBeGreaterThan(0)
    expect(successfulOperations.leafDelete).toBeGreaterThan(0)
    expect(successfulOperations.subtreeDelete).toBeGreaterThan(0)
  })
})
