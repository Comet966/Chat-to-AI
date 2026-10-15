import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnSelectionChangeParams
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ConversationTreeNode } from './ConversationTreeNode.js'
import { ConversationTreeEdge } from './ConversationTreeEdge.js'
import type { ConversationTreeNodeData } from './mapping/to-flow-elements.js'

type ConversationFlowNode = Node<ConversationTreeNodeData>

export interface ConversationTreeCanvasHandle {
  fitView: () => void
  focusNode: (nodeId: string) => void
}

export interface ConversationTreeCanvasProps {
  nodes: ConversationFlowNode[]
  edges: Edge[]
  currentNodeId: string
  onNodeClick: (nodeId: string, isMulti: boolean) => void
  onPaneClick: () => void
  onSelectionChange: (nodeIds: string[]) => void
}

const nodeTypes = {
  conversationNode: ConversationTreeNode
}

const edgeTypes = {
  conversationBezier: ConversationTreeEdge
}

const TREE_FIT_OPTIONS = { padding: 0.25, minZoom: 0.02, maxZoom: 1 }

export const ConversationTreeCanvas = React.forwardRef<
  ConversationTreeCanvasHandle,
  ConversationTreeCanvasProps
>(function ConversationTreeCanvas(
  { nodes, edges, currentNodeId, onNodeClick, onPaneClick, onSelectionChange },
  ref
) {
  return (
    <ReactFlowProvider>
      <InnerCanvas
        ref={ref}
        nodes={nodes}
        edges={edges}
        currentNodeId={currentNodeId}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
      />
    </ReactFlowProvider>
  )
})

interface InnerCanvasProps extends ConversationTreeCanvasProps {
  currentNodeId: string
}

const InnerCanvas = React.forwardRef<ConversationTreeCanvasHandle, InnerCanvasProps>(
  function InnerCanvas(
    { nodes, edges, currentNodeId, onNodeClick, onPaneClick, onSelectionChange },
    ref
  ) {
    const { fitView, setCenter, getNode, viewportInitialized } = useReactFlow()
    const nodesInitialized = useNodesInitialized()
    const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null)
    const lastFittedLayout = useRef<string | null>(null)
    // Selection, hover, and context highlights must not reset a user's view.
    // Topology/layout changes, however, can move existing nodes off screen.
    const layoutKey = JSON.stringify({
      nodes: nodes.map(({ id, position }) => [id, position.x, position.y]),
      edges: edges.map(({ source, target }) => [source, target])
    })

    const handleFitView = useCallback(() => {
      void fitView({ ...TREE_FIT_OPTIONS, duration: 300 })
    }, [fitView])

    const handleFocusNode = useCallback(
      (nodeId: string) => {
        const node = getNode(nodeId)
        if (node) {
          // Center on node
          const x = node.position.x + (node.measured?.width ?? 48) / 2
          const y = node.position.y + (node.measured?.height ?? 48) / 2
          setCenter(x, y, { duration: 350, zoom: 1 })
        }
      },
      [getNode, setCenter]
    )

    useImperativeHandle(
      ref,
      () => ({
        fitView: handleFitView,
        focusNode: handleFocusNode
      }),
      [handleFitView, handleFocusNode]
    )

    // Fit every new layout after ReactFlow has measured the nodes. A fixed
    // timeout can be cancelled by a fast update (or StrictMode), leaving a
    // stale viewport that looks as though the previous turn was deleted.
    useEffect(() => {
      if (nodes.length === 0) {
        lastFittedLayout.current = null
        return
      }
      if (!nodesInitialized || !viewportInitialized || lastFittedLayout.current === layoutKey) return

      let cancelled = false
      const frame = requestAnimationFrame(() => {
        void fitView(TREE_FIT_OPTIONS).then((fitted) => {
          if (fitted && !cancelled) lastFittedLayout.current = layoutKey
        })
      })
      return () => {
        cancelled = true
        cancelAnimationFrame(frame)
      }
    }, [layoutKey, nodes.length, nodesInitialized, viewportInitialized, fitView])

    const handleNodeClick = useCallback(
      (event: React.MouseEvent, node: Node) => {
        event.stopPropagation()
        onNodeClick(node.id, event.metaKey || event.ctrlKey)
      },
      [onNodeClick]
    )

    const handleSelectionChange = useCallback(
      (params: OnSelectionChangeParams) => {
        if (params.nodes && params.nodes.length > 0) {
          onSelectionChange(params.nodes.map((n) => n.id))
        }
      },
      [onSelectionChange]
    )

    const handleNodeMouseEnter = useCallback<NodeMouseHandler<ConversationFlowNode>>(
      (_event, node) => setHoveredNodeId(node.id),
      []
    )

    const handleNodeMouseLeave = useCallback<NodeMouseHandler<ConversationFlowNode>>(
      (_event, node) => {
        setHoveredNodeId((currentId) => (currentId === node.id ? null : currentId))
      },
      []
    )

    const hoveredNode = nodes.find((node) => node.id === hoveredNodeId)

    const proOptions = useMemo(() => ({ hideAttribution: true }), [])

    return (
      <div className="tree-canvas-wrapper" data-testid="tree-canvas-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onPaneClick={onPaneClick}
          onSelectionChange={handleSelectionChange}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          selectionOnDrag={false}
          panOnDrag={true}
          deleteKeyCode={null}
          proOptions={proOptions}
          minZoom={TREE_FIT_OPTIONS.minZoom}
          maxZoom={2}
        >
          <Background color="var(--color-border)" gap={20} size={1} />
        </ReactFlow>

        {hoveredNode && (
          <div className="tree-node-tooltip" role="tooltip">
            <div className="tree-node-tooltip-header">
              <span>第 {hoveredNode.data.sequence + 1} 轮问答</span>
              {hoveredNode.data.isCurrent && <span>当前节点</span>}
            </div>
            <div className="tree-node-tooltip-section">
              <span className="tree-node-tooltip-label">问</span>
              <p className="tree-node-tooltip-content">{hoveredNode.data.question}</p>
            </div>
            <div className="tree-node-tooltip-section">
              <span className="tree-node-tooltip-label is-answer">答</span>
              <p className="tree-node-tooltip-content">{hoveredNode.data.answer}</p>
            </div>
            {hoveredNode.data.providerInfo && (
              <p className="tree-node-tooltip-model">
                {hoveredNode.data.providerInfo.provider} / {hoveredNode.data.providerInfo.modelId}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }
)
