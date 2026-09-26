import React from 'react'
import { Button } from '../../components/Button.js'
import type { ConversationInheritanceMode } from '../../ports/conversation-tree-ui.port.js'

export interface ConversationTreeToolbarProps {
  selectedCount: number
  inheritanceMode: ConversationInheritanceMode
  inheritedCount: number
  protectedRootSelected: boolean
  canSetCurrent: boolean
  canAddChild: boolean
  canDelete: boolean
  isActionInProgress: boolean
  onSetCurrent: () => void
  onAddChild: () => void
  onDelete: () => void
  onFitView: () => void
  onFocusCurrent: () => void
  onInheritanceModeChange: (mode: ConversationInheritanceMode) => void
}

export function ConversationTreeToolbar({
  selectedCount,
  inheritanceMode,
  inheritedCount,
  protectedRootSelected,
  canSetCurrent,
  canAddChild,
  canDelete,
  isActionInProgress,
  onSetCurrent,
  onAddChild,
  onDelete,
  onFitView,
  onFocusCurrent,
  onInheritanceModeChange
}: ConversationTreeToolbarProps) {
  return (
    <div className="tree-toolbar" role="toolbar" aria-label="会话树操作栏">
      <div className="tree-inheritance-control">
        <div className="tree-inheritance-copy">
          <span className="tree-inheritance-title">上下文继承</span>
          <span className="tree-inheritance-summary">已包含 {inheritedCount} 轮</span>
        </div>
        <div className="tree-mode-switch" aria-label="选择会话继承模式">
          <button
            type="button"
            className="tree-mode-button"
            aria-pressed={inheritanceMode === 'root-path'}
            onClick={() => onInheritanceModeChange('root-path')}
          >
            根路径继承
          </button>
          <button
            type="button"
            className="tree-mode-button"
            aria-pressed={inheritanceMode === 'manual'}
            onClick={() => onInheritanceModeChange('manual')}
          >
            自由选择
          </button>
        </div>
        <p className="tree-inheritance-help">
          {inheritanceMode === 'root-path'
            ? '自动继承从根节点到当前节点的全部问答。'
            : '点击圆形节点，将任意问答加入或移出上下文。'}
        </p>
      </div>

      <div className="tree-toolbar-actions">
        <Button
          type="button"
          variant="secondary"
          className="tree-toolbar-btn"
          disabled={!canSetCurrent || isActionInProgress}
          onClick={onSetCurrent}
          aria-label="设为当前节点"
        >
          设为当前
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="tree-toolbar-btn"
          disabled={!canAddChild || isActionInProgress}
          onClick={onAddChild}
          aria-label="新增子节点或分支"
        >
          新增节点
        </Button>
        <Button
          type="button"
          variant="danger"
          className="tree-toolbar-btn"
          disabled={!canDelete || isActionInProgress}
          onClick={onDelete}
          aria-label="删除所选节点"
        >
          删除所选
        </Button>
      </div>

      <div className="tree-toolbar-views">
        <span className="tree-toolbar-counter">
          {selectedCount > 0 ? `已选 ${selectedCount} 项` : '未选节点'}
        </span>
        {protectedRootSelected && (
          <span className="tree-toolbar-protection" role="status">
            根节点受保护，将跳过根节点
          </span>
        )}
        <Button
          type="button"
          variant="secondary"
          className="tree-toolbar-icon-btn"
          onClick={onFitView}
          title="适应画布"
          aria-label="适应画布"
        >
          适应画布
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="tree-toolbar-icon-btn"
          onClick={onFocusCurrent}
          title="定位到当前节点"
          aria-label="定位到当前节点"
        >
          定位当前
        </Button>
      </div>
    </div>
  )
}
