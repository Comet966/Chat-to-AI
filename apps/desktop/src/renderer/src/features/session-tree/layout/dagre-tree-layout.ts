import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

export interface LayoutOptions {
  nodeWidth?: number
  nodeHeight?: number
  nodesep?: number
  ranksep?: number
}

export const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  nodeWidth: 48,
  nodeHeight: 48,
  nodesep: 44,
  ranksep: 56
}

export function dagreTreeLayout<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  options?: LayoutOptions
): { nodes: Node<T>[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options }
  const dagreLib = (dagre as unknown as { default?: typeof dagre }).default ?? dagre
  const g = new dagreLib.graphlib.Graph()

  g.setGraph({
    rankdir: 'TB',
    nodesep: opts.nodesep,
    ranksep: opts.ranksep,
    marginx: 20,
    marginy: 20
  })
  g.setDefaultEdgeLabel(() => ({}))

  // 1. Set all nodes
  for (const node of nodes) {
    g.setNode(node.id, { width: opts.nodeWidth, height: opts.nodeHeight })
  }

  // 2. Stable edge insertion: sort edges by target node's sequence if available
  const sortedEdges = [...edges].sort((a, b) => {
    const nodeA = nodes.find((n) => n.id === a.target)
    const nodeB = nodes.find((n) => n.id === b.target)
    const seqA = typeof nodeA?.data?.sequence === 'number' ? nodeA.data.sequence : 0
    const seqB = typeof nodeB?.data?.sequence === 'number' ? nodeB.data.sequence : 0
    if (seqA !== seqB) {
      return seqA - seqB
    }
    return a.target.localeCompare(b.target)
  })

  for (const edge of sortedEdges) {
    g.setEdge(edge.source, edge.target)
  }

  // 3. Execute layout
  dagreLib.layout(g)

  // 4. Map coordinates back to React Flow nodes (top-left aligned)
  const positionedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id)
    if (!nodeWithPosition) {
      return node
    }

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - opts.nodeWidth / 2,
        y: nodeWithPosition.y - opts.nodeHeight / 2
      }
    }
  })

  return {
    nodes: positionedNodes,
    edges
  }
}
