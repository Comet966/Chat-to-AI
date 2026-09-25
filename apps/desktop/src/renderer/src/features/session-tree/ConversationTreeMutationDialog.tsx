import React, { useState } from 'react'
import { Button } from '../../components/Button.js'
import { Field } from '../../components/Field.js'
import { StatusNotice } from '../../components/StatusNotice.js'
import type {
  ConversationTreeDeleteMode,
  ConversationNodeRole,
  ConversationTreeNodeDto,
  ConversationTreeSnapshot
} from '../../ports/conversation-tree-ui.port.js'
import { getConversationTreeDeletePreview } from './mapping/delete-preview.js'

export interface AddDialogProps {
  type: 'add'
  parentNode: ConversationTreeNodeDto
  onConfirm: (role: ConversationNodeRole, content: string) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

export interface DeleteDialogProps {
  type: 'delete'
  snapshot: ConversationTreeSnapshot
  nodesToDelete: ConversationTreeNodeDto[]
  onConfirm: (mode: ConversationTreeDeleteMode) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

export type ConversationTreeMutationDialogProps = AddDialogProps | DeleteDialogProps

export function ConversationTreeMutationDialog(props: ConversationTreeMutationDialogProps) {
  if (props.type === 'add') {
    return <AddNodeModal {...props} />
  }
  return <DeleteNodeModal {...props} />
}

function AddNodeModal({
  parentNode,
  onConfirm,
  onCancel,
  isSubmitting
}: AddDialogProps) {
  const defaultRole: ConversationNodeRole =
    parentNode.role === 'user' ? 'assistant' : 'user'
  const [role, setRole] = useState<ConversationNodeRole>(defaultRole)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) {
      setError('内容不能为空')
      return
    }
    setError(null)
    await onConfirm(role, content.trim())
  }

  return (
    <div className="tree-modal-backdrop" role="dialog" aria-modal="true" aria-label="新增子节点">
      <div className="tree-modal-card">
        <h3 className="tree-modal-title">新增子节点 / 分支</h3>
        <p className="tree-modal-subtitle">
          父节点: #{parentNode.sequence} ({parentNode.role}):{' '}
          {parentNode.content.slice(0, 50)}
          {parentNode.content.length > 50 ? '...' : ''}
        </p>

        <StatusNotice
          type="info"
          message="当前为 UI Preview，新增节点仅存在于本次内存会话中。"
        />

        <form onSubmit={handleSubmit} noValidate>
          <Field label="角色 (Role)" htmlFor="node-role">
            <select
              id="node-role"
              className="field-select"
              value={role}
              onChange={(e) => setRole(e.target.value as ConversationNodeRole)}
            >
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
              <option value="system">System</option>
            </select>
          </Field>

          <Field label="节点内容" htmlFor="node-content" error={error ?? undefined}>
            <textarea
              id="node-content"
              className="field-textarea tree-modal-textarea"
              rows={4}
              placeholder="输入该节点的消息内容..."
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                if (error) setError(null)
              }}
              autoFocus
            />
          </Field>

          <div className="tree-modal-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !content.trim()}
            >
              {isSubmitting ? '添加中...' : '确认添加'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteNodeModal({
  snapshot,
  nodesToDelete,
  onConfirm,
  onCancel,
  isSubmitting
}: DeleteDialogProps) {
  const [mode, setMode] = useState<ConversationTreeDeleteMode>('subtree')
  const preview = getConversationTreeDeletePreview(
    snapshot,
    nodesToDelete.map((node) => node.id),
    mode
  )
  const canConfirm = preview.affectedNodeIds.length > 0 && preview.nonLeafNodeIds.length === 0

  return (
    <div
      className="tree-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="确认删除节点"
    >
      <div className="tree-modal-card">
        <h3 className="tree-modal-title">确认删除节点</h3>
        <p className="tree-modal-subtitle">
          已选择 {nodesToDelete.length} 个节点；本次将实际影响 {preview.affectedNodeIds.length} 个节点。
        </p>

        <Field label="删除模式" htmlFor="delete-mode">
          <select
            id="delete-mode"
            className="field-select"
            value={mode}
            onChange={(event) => setMode(event.target.value as ConversationTreeDeleteMode)}
            disabled={isSubmitting}
          >
            <option value="subtree">删除节点及其子树</option>
            <option value="leaf-only">仅删除叶节点</option>
          </select>
        </Field>

        <StatusNotice
          type="warning"
          message={
            mode === 'subtree'
              ? '子树删除会递归移除所选节点及其所有后代。操作仅在本次 UI Preview 会话中生效。'
              : '叶节点删除只允许没有子节点的节点；请改用子树删除来移除分支。'
          }
        />

        {preview.nonLeafNodeIds.length > 0 && (
          <StatusNotice
            type="danger"
            message="当前选择包含非叶节点，不能使用“仅删除叶节点”模式。"
          />
        )}

        <div className="tree-modal-delete-list">
          {nodesToDelete.map((node) => (
            <div key={node.id} className="tree-modal-delete-item">
              <span className="tree-node-role-badge">#{node.sequence}</span>
              <span className="tree-modal-delete-text">
                {node.content.slice(0, 60)}
                {node.content.length > 60 ? '...' : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="tree-modal-actions">
            <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
              onClick={() => void onConfirm(mode)}
              disabled={isSubmitting || !canConfirm}
          >
            {isSubmitting ? '删除中...' : '确认删除'}
          </Button>
        </div>
      </div>
    </div>
  )
}
