import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type {
  ConversationNodeProviderInfo,
  ConversationNodeRole,
  ConversationTreeNodeDto,
  ConversationTreeSnapshot
} from '../../../ports/conversation-tree-ui.port.js'

export interface ConversationTreeNodeData extends Record<string, unknown> {
  id: string
  role: ConversationNodeRole
  content: string
  contentSnippet: string
  sequence: number
  createdAt: string
  providerInfo?: ConversationNodeProviderInfo
  isCurrent: boolean
  isPath: boolean
  isSelected: boolean
}

export function createContentSnippet(content: string, maxLen = 60): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, maxLen)}...`
}

export interface FlowElementsResult {
  nodes: Node<ConversationTreeNodeData>[]
  edges: Edge[]
  activePathNodeIds: Set<string>
  activePathEdgeIds: Set<string>
}

export function toFlowElements(
  snapshot: ConversationTreeSnapshot,
  selectedNodeIds: Set<string>
): FlowElementsResult {
  const nodeMap = new Map<string, ConversationTreeNodeDto>()
  for (const node of snapshot.nodes) {
    nodeMap.set(node.id, node)
  }

  // 1. Calculate active path from root to current node
  const activePathNodeIds = new Set<string>()
  const activePathEdgeIds = new Set<string>()

  let current: ConversationTreeNodeDto | undefined = nodeMap.get(snapshot.currentNodeId)
  while (current) {
    activePathNodeIds.add(current.id)
    if (current.parentId) {
      activePathEdgeIds.add(`edge-${current.parentId}-${current.id}`)
      current = nodeMap.get(current.parentId)
    } else {
      break
    }
  }

  // 2. Generate nodes
  const nodes: Node<ConversationTreeNodeData>[] = snapshot.nodes.map((node) => {
    const isCurrent = node.id === snapshot.currentNodeId
    const isPath = activePathNodeIds.has(node.id)
    const isSelected = selectedNodeIds.has(node.id)

    return {
      id: node.id,
      type: 'conversationNode',
      position: { x: 0, y: 0 },
      data: {
        id: node.id,
        role: node.role,
        content: node.content,
        contentSnippet: createContentSnippet(node.content),
        sequence: node.sequence,
        createdAt: node.createdAt,
        providerInfo: node.providerInfo,
        isCurrent,
        isPath,
        isSelected
      },
      draggable: false,
      selectable: true
    }
  })

  // 3. Generate edges
  const edges: Edge[] = snapshot.nodes
    .filter((node) => node.parentId !== null)
    .map((node) => {
      const edgeId = `edge-${node.parentId}-${node.id}`
      const isPath = activePathEdgeIds.has(edgeId)

      return {
        id: edgeId,
        source: node.parentId as string,
        target: node.id,
        type: 'smoothstep',
        selectable: false,
        className: isPath ? 'edge-active-path' : 'edge-default',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isPath ? 'var(--color-primary)' : 'var(--color-border)'
        }
      }
    })

  return {
    nodes,
    edges,
    activePathNodeIds,
    activePathEdgeIds
  }
}
