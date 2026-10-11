// @vitest-environment jsdom
import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationTreeCanvas } from '../../apps/desktop/src/renderer/src/features/session-tree/ConversationTreeCanvas.js'

const flow = vi.hoisted(() => ({
  fitView: vi.fn().mockResolvedValue(true),
  setCenter: vi.fn(),
  getNode: vi.fn(),
  nodesInitialized: true,
  viewportInitialized: true
}))

vi.mock('../../apps/desktop/node_modules/@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  ReactFlow: () => null,
  Background: () => null,
  Handle: () => null,
  BaseEdge: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => flow,
  useNodesInitialized: () => flow.nodesInitialized
}))

function canvas(count: number, selected = false) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `turn-${index}`,
    position: { x: 20, y: 20 + index * 104 },
    selected,
    data: {
      id: `turn-${index}`, question: 'Q', answer: 'A', questionSnippet: 'Q',
      sequence: index, createdAt: '', isCurrent: index === count - 1,
      isPath: true, isSelected: selected, isHighlighted: false, isInherited: true
    }
  }))
  return (
    <ConversationTreeCanvas
      nodes={nodes}
      edges={nodes.slice(1).map((node, index) => ({
        id: `edge-${index}`, source: nodes[index]!.id, target: node.id
      }))}
      currentNodeId={`turn-${count - 1}`}
      onNodeClick={() => {}} onPaneClick={() => {}} onSelectionChange={() => {}}
    />
  )
}

async function nextFrame() {
  await act(async () => { vi.advanceTimersByTime(100) })
}

describe('conversation tree viewport after completed turns', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    flow.fitView.mockClear()
    flow.nodesInitialized = true
    flow.viewportInitialized = true
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 16))
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => clearTimeout(frame))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fits the full tree after each completed turn without resetting the view on selection', async () => {
    const view = render(canvas(1))
    await nextFrame()
    expect(flow.fitView).toHaveBeenCalledTimes(1)
    view.rerender(canvas(2))
    await nextFrame()
    view.rerender(canvas(3))
    await nextFrame()
    expect(flow.fitView).toHaveBeenCalledTimes(3)
    expect(flow.fitView).toHaveBeenLastCalledWith(expect.objectContaining({ maxZoom: 1 }))
    view.rerender(canvas(3, true))
    await nextFrame()
    expect(flow.fitView).toHaveBeenCalledTimes(3)
  })

  it('waits for node measurement and survives StrictMode effect cancellation', async () => {
    flow.nodesInitialized = false
    const view = render(<React.StrictMode>{canvas(1)}</React.StrictMode>)
    await nextFrame()
    expect(flow.fitView).not.toHaveBeenCalled()
    flow.nodesInitialized = true
    view.rerender(<React.StrictMode>{canvas(1)}</React.StrictMode>)
    await nextFrame()
    expect(flow.fitView).toHaveBeenCalledTimes(1)
    view.rerender(<React.StrictMode>{canvas(2)}</React.StrictMode>)
    view.rerender(<React.StrictMode>{canvas(3)}</React.StrictMode>)
    await nextFrame()
    expect(flow.fitView).toHaveBeenCalledTimes(2)
  })
})
