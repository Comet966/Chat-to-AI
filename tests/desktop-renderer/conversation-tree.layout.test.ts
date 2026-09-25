import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEMO_TREE_SNAPSHOT
} from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import {
  toFlowElements
} from '../../apps/desktop/src/renderer/src/features/session-tree/mapping/to-flow-elements.js'
import {
  dagreTreeLayout
} from '../../apps/desktop/src/renderer/src/features/session-tree/layout/dagre-tree-layout.js'

describe('Dagre Tree Layout', () => {
  it('positions root node on top and child nodes below parents (hierarchical y-coordinates)', () => {
    const { nodes, edges } = toFlowElements(DEFAULT_DEMO_TREE_SNAPSHOT, new Set())
    const layout = dagreTreeLayout(nodes, edges)

    expect(layout.nodes.length).toBe(6)

    const rootNode = layout.nodes.find((n) => n.id === 'node-root')!
    const u1Node = layout.nodes.find((n) => n.id === 'node-u1')!
    const a1Node = layout.nodes.find((n) => n.id === 'node-a1')!
    const u2Node = layout.nodes.find((n) => n.id === 'node-u2')!
    const b1Node = layout.nodes.find((n) => n.id === 'node-a2-b1')!
    const b2Node = layout.nodes.find((n) => n.id === 'node-a2-b2')!

    // Verify vertical order: root.y < u1.y < a1.y < u2.y < b1.y == b2.y
    expect(rootNode.position.y).toBeLessThan(u1Node.position.y)
    expect(u1Node.position.y).toBeLessThan(a1Node.position.y)
    expect(a1Node.position.y).toBeLessThan(u2Node.position.y)
    expect(u2Node.position.y).toBeLessThan(b1Node.position.y)
    expect(b1Node.position.y).toBe(b2Node.position.y)

    // Branch nodes at same level must not overlap horizontally
    expect(b1Node.position.x).not.toBe(b2Node.position.x)
    expect(Math.abs(b1Node.position.x - b2Node.position.x)).toBeGreaterThanOrEqual(240) // width
  })

  it('produces deterministic output for identical input', () => {
    const { nodes, edges } = toFlowElements(DEFAULT_DEMO_TREE_SNAPSHOT, new Set())
    const layout1 = dagreTreeLayout(nodes, edges)
    const layout2 = dagreTreeLayout(nodes, edges)

    expect(layout1.nodes.map((n) => n.position)).toEqual(layout2.nodes.map((n) => n.position))
  })

  it('selection state changes do not affect node coordinates', () => {
    const { nodes: nodes1, edges: edges1 } = toFlowElements(DEFAULT_DEMO_TREE_SNAPSHOT, new Set())
    const { nodes: nodes2, edges: edges2 } = toFlowElements(
      DEFAULT_DEMO_TREE_SNAPSHOT,
      new Set(['node-a2-b1', 'node-u1'])
    )

    const layout1 = dagreTreeLayout(nodes1, edges1)
    const layout2 = dagreTreeLayout(nodes2, edges2)

    expect(layout1.nodes.map((n) => n.position)).toEqual(layout2.nodes.map((n) => n.position))
  })
})
