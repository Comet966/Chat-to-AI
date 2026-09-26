import React from 'react'
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import { createConversationTreeEdgePath } from './conversation-tree-edge-path.js'

export type ConversationTreeFlowEdge = Edge<Record<string, never>, 'conversationBezier'>

/**
 * React Flow edge renderer with a small lateral bow. The built-in bezier edge
 * becomes visually straight when source and target share the same x coordinate;
 * this keeps every hierarchy connection visibly curved while retaining React
 * Flow's edge lifecycle, markers, hit area, selection and viewport transforms.
 */
export function ConversationTreeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  interactionWidth
}: EdgeProps<ConversationTreeFlowEdge>) {
  const path = createConversationTreeEdgePath({ id, sourceX, sourceY, targetX, targetY })

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  )
}
