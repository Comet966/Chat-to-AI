import { describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_TREE_SNAPSHOT } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import { getConversationTreeDeletePreview } from '../../apps/desktop/src/renderer/src/features/session-tree/mapping/delete-preview.js'

describe('conversation tree delete preview', () => {
  it('normalizes an ancestor and descendant to one subtree operation root', () => {
    const preview = getConversationTreeDeletePreview(
      DEFAULT_DEMO_TREE_SNAPSHOT,
      ['node-u2', 'node-a2-b1'],
      'subtree'
    )

    expect(preview.normalizedNodeIds).toEqual(['node-u2'])
    expect(new Set(preview.affectedNodeIds)).toEqual(
      new Set(['node-u2', 'node-a2-b1', 'node-a2-b2'])
    )
  })

  it('excludes the protected root and reports non-leaf leaf-only requests', () => {
    const preview = getConversationTreeDeletePreview(
      DEFAULT_DEMO_TREE_SNAPSHOT,
      ['node-root', 'node-u2'],
      'leaf-only'
    )

    expect(preview.normalizedNodeIds).toEqual(['node-u2'])
    expect(preview.nonLeafNodeIds).toEqual(['node-u2'])
    expect(preview.affectedNodeIds).toEqual([])
  })
})
