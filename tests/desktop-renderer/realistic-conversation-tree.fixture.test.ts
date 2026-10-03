import { describe, expect, it } from 'vitest'
import { REALISTIC_CONVERSATION_TREE_FIXTURE } from '../../apps/desktop/src/renderer/src/adapters/fixtures/realistic-conversation-tree.fixture.js'
import { validateTreeSnapshot } from '../../apps/desktop/src/renderer/src/features/session-tree/mapping/validate-tree-snapshot.js'

describe('realistic conversation tree visual-review fixture', () => {
  it('is a valid projected turn tree with branches and mixed providers', () => {
    expect(validateTreeSnapshot(REALISTIC_CONVERSATION_TREE_FIXTURE)).toEqual({ valid: true })

    const childCounts = new Map<string, number>()
    for (const node of REALISTIC_CONVERSATION_TREE_FIXTURE.nodes) {
      if (node.parentId) {
        childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1)
      }
    }

    expect(REALISTIC_CONVERSATION_TREE_FIXTURE.nodes).toHaveLength(14)
    expect(
      REALISTIC_CONVERSATION_TREE_FIXTURE.nodes.map((node) => node.sequence)
    ).toEqual(Array.from({ length: 14 }, (_, index) => index))
    expect([...childCounts.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(3)
    expect(
      new Set(
        REALISTIC_CONVERSATION_TREE_FIXTURE.nodes.map((node) => node.providerInfo?.provider)
      )
    ).toEqual(new Set(['anthropic', 'openai-compatible', 'gemini']))
  })
})
