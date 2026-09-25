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

  const cardClasses = [
    'tree-node-card',
    `role-${data.role}`,
    data.isCurrent ? 'is-current' : '',
    data.isPath ? 'is-path' : '',
    data.isSelected ? 'is-selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cardClasses}
      role="treeitem"
      aria-selected={data.isSelected}
      aria-label={`${roleName} node ${data.sequence}: ${data.contentSnippet}`}
      data-testid={`tree-node-${data.id}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="tree-node-handle" />

      <div className="tree-node-header">
        <div className="tree-node-tags">
          <span className={`tree-node-role-badge role-badge-${data.role}`}>
            {roleName}
          </span>
          <span className="tree-node-seq-badge">#{data.sequence}</span>
          {data.providerInfo && (
            <span className="tree-node-provider-badge">
              {data.providerInfo.modelId}
            </span>
          )}
        </div>
        {data.isCurrent && (
          <span className="tree-node-current-badge" title="当前对话上下文节点">
            ★ 当前
          </span>
        )}
      </div>

      <div className="tree-node-body">
        <p className="tree-node-content">{data.contentSnippet}</p>
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={false} className="tree-node-handle" />
    </div>
  )
}
