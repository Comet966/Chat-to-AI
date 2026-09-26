import React from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ConversationTreeNodeData } from './mapping/to-flow-elements.js'

export function ConversationTreeNode({
  data
}: NodeProps<Node<ConversationTreeNodeData>>) {
  const roleLabels: Record<string, string> = {
    system: 'System',
    user: 'User',
    assistant: 'Assistant'
  }

  const roleName = roleLabels[data.role] ?? data.role

  const nodeClasses = [
    'tree-node-circle',
    `role-${data.role}`,
    data.isCurrent ? 'is-current' : '',
    data.isPath ? 'is-path' : '',
    data.isSelected ? 'is-selected' : '',
    data.isHighlighted ? 'is-highlighted' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={nodeClasses}
      role="treeitem"
      tabIndex={0}
      aria-selected={data.isSelected}
      aria-label={`${roleName} node ${data.sequence}: ${data.contentSnippet}`}
      data-testid={`tree-node-${data.id}`}
      data-highlighted={data.isHighlighted ? 'true' : 'false'}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="tree-node-handle" />

      <span className="tree-node-sequence" aria-hidden="true">
        {data.sequence}
      </span>

      <Handle type="source" position={Position.Bottom} isConnectable={false} className="tree-node-handle" />
    </div>
  )
}
