import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_TREE_SNAPSHOT } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import { ConversationTreeCanvas } from '../../apps/desktop/src/renderer/src/features/session-tree/ConversationTreeCanvas.js'
import { dagreTreeLayout } from '../../apps/desktop/src/renderer/src/features/session-tree/layout/dagre-tree-layout.js'
import { toFlowElements } from '../../apps/desktop/src/renderer/src/features/session-tree/mapping/to-flow-elements.js'

function canvas(count: number, currentIndex = count - 1) {
  const snapshot = {
    ...DEFAULT_DEMO_TREE_SNAPSHOT,
    nodes: DEFAULT_DEMO_TREE_SNAPSHOT.nodes.slice(0, count),
    currentNodeId: DEFAULT_DEMO_TREE_SNAPSHOT.nodes[currentIndex]!.id
  }
  const elements = toFlowElements(snapshot, new Set([snapshot.currentNodeId]))
  const layout = dagreTreeLayout(elements.nodes, elements.edges)
  return (
    <ConversationTreeCanvas
      {...layout}
      currentNodeId={snapshot.currentNodeId}
      onNodeClick={() => {}} onPaneClick={() => {}} onSelectionChange={() => {}}
    />
  )
}

async function expectEdges(container: HTMLElement, count: number) {
  await waitFor(() => {
    const paths = container.querySelectorAll('.react-flow__edge-path')
    expect(paths).toHaveLength(count)
    for (const path of paths) {
      expect(path.getAttribute('d')).toMatch(/^M/)
      expect(path.getAttribute('d')).not.toMatch(/NaN|undefined/)
    }
  })
}

describe('conversation tree edges in the real ReactFlow canvas', () => {
  // ResizeObserver is a no-op in jsdom. Fixed-size nodes must supply their
  // geometry themselves, including after controlled snapshots replace them.
  it('keeps connecting paths after completed turns and switching the current node', async () => {
    const view = render(canvas(2))
    await expectEdges(view.container, 1)
    view.rerender(canvas(3))
    await expectEdges(view.container, 2)
    view.rerender(canvas(3, 0))
    await expectEdges(view.container, 2)
    expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(3)
  })

  it('renders both branches and preserves the remaining path after deletion', async () => {
    const view = render(canvas(5))
    await expectEdges(view.container, 4)
    view.rerender(canvas(6))
    await expectEdges(view.container, 5)
    view.rerender(canvas(5))
    await expectEdges(view.container, 4)
  })
})
