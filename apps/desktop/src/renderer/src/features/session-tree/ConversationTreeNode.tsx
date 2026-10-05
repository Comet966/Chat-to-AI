import React from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ConversationTreeNodeData } from './mapping/to-flow-elements.js'

export function ConversationTreeNode({
  data
}: NodeProps<Node<ConversationTreeNodeData>>) {
  const nodeClasses = [
    'tree-node-circle',
    data.isCurrent ? 'is-current' : '',
    data.isPath ? 'is-path' : '',
    data.isSelected ? 'is-selected' : '',
    data.isHighlighted ? 'is-highlighted' : '',
    data.isInherited ? 'is-inherited' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={nodeClasses}
      role="treeitem"
      tabIndex={0}
      aria-selected={data.isSelected}
      aria-label={`第 ${data.sequence + 1} 轮问答: ${data.questionSnippet}`}
      data-testid={`tree-node-${data.id}`}
      data-highlighted={data.isHighlighted ? 'true' : 'false'}
      data-inherited={data.isInherited ? 'true' : 'false'}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="tree-node-handle" />

      <span className="tree-node-sequence" aria-hidden="true">
        {data.sequence + 1}
      </span>

      <Handle type="source" position={Position.Bottom} isConnectable={false} className="tree-node-handle" />
    </div>
  )
}
