import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type OnSelectionChangeParams
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ConversationTreeNode } from './ConversationTreeNode.js'
import type { ConversationTreeNodeData } from './mapping/to-flow-elements.js'

export interface ConversationTreeCanvasHandle {
  fitView: () => void
  focusNode: (nodeId: string) => void
}

export interface ConversationTreeCanvasProps {
  nodes: Node<ConversationTreeNodeData>[]
  edges: Edge[]
  currentNodeId: string
  onNodeClick: (nodeId: string, isMulti: boolean) => void
  onPaneClick: () => void
  onSelectionChange: (nodeIds: string[]) => void
}

const nodeTypes = {
  conversationNode: ConversationTreeNode
}

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
    const { fitView, setCenter, getNode } = useReactFlow()
    const hasInitializedFitView = useRef(false)

    const handleFitView = useCallback(() => {
      fitView({ padding: 0.2, duration: 300 })
    }, [fitView])

    const handleFocusNode = useCallback(
      (nodeId: string) => {
        const node = getNode(nodeId)
        if (node) {
          // Center on node
          const x = node.position.x + (node.measured?.width ?? 240) / 2
          const y = node.position.y + (node.measured?.height ?? 96) / 2
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

    // Fit view on first valid layout
    useEffect(() => {
      if (nodes.length > 0 && !hasInitializedFitView.current) {
        hasInitializedFitView.current = true
        // Delay slightly for ReactFlow measurement
        const timer = setTimeout(() => {
          fitView({ padding: 0.25 })
        }, 50)
        return () => clearTimeout(timer)
      }
      return undefined
    }, [nodes.length, fitView])

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

    const proOptions = useMemo(() => ({ hideAttribution: true }), [])

    return (
      <div className="tree-canvas-wrapper" data-testid="tree-canvas-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onPaneClick={onPaneClick}
          onSelectionChange={handleSelectionChange}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          selectionOnDrag={true}
          panOnDrag={[1, 2]} // Pan on middle/right mouse or drag
          deleteKeyCode={null}
          proOptions={proOptions}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background color="var(--color-border)" gap={20} size={1} />
        </ReactFlow>
      </div>
    )
  }
)
