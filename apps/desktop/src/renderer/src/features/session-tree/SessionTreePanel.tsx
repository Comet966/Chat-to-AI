import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Button } from '../../components/Button.js'
import { StatusNotice } from '../../components/StatusNotice.js'
import { usePorts } from '../../ports/ports.context.js'
import { DemoConversationTreeUiAdapter } from '../../adapters/demo-conversation-tree-ui.adapter.js'
import type {
  ConversationNodeRole,
  ConversationTreeDeleteMode
} from '../../ports/conversation-tree-ui.port.js'
import { ConversationTreeCanvas, type ConversationTreeCanvasHandle } from './ConversationTreeCanvas.js'
import { ConversationTreeMutationDialog } from './ConversationTreeMutationDialog.js'
import { ConversationTreeToolbar } from './ConversationTreeToolbar.js'
import {
  conversationTreeReducer,
  initialConversationTreeState
} from './conversation-tree.reducer.js'
import { dagreTreeLayout } from './layout/dagre-tree-layout.js'
import { toFlowElements } from './mapping/to-flow-elements.js'
import { validateTreeSnapshot } from './mapping/validate-tree-snapshot.js'

export interface SessionTreePanelProps {
  /**
   * Presentation-only highlight state. Callers can use this to emphasize search
   * results, generated nodes, or other transient UI state without mutating the tree.
   */
  highlightedNodeIds?: readonly string[]
}

export function SessionTreePanel({ highlightedNodeIds = [] }: SessionTreePanelProps) {
  const ports = usePorts()
  const port = useMemo(
    () => ports.conversationTree ?? new DemoConversationTreeUiAdapter(),
    [ports.conversationTree]
  )
  const [state, dispatch] = useReducer(conversationTreeReducer, initialConversationTreeState)
  const canvasRef = useRef<ConversationTreeCanvasHandle>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const highlightedNodeIdSet = useMemo(
    () => new Set(highlightedNodeIds),
    [highlightedNodeIds]
  )

  // 1. Fetch snapshot and subscribe to updates
  useEffect(() => {
    let isMounted = true
    dispatch({ type: 'loadStart' })

    void port.getSnapshot().then((res) => {
      if (!isMounted) return
      if (res.ok) {
        dispatch({ type: 'loadSuccess', snapshot: res.value })
      } else {
        dispatch({ type: 'loadError', error: res.error.message })
      }
    })

    const unsubscribe = port.subscribe((updatedSnapshot) => {
      if (isMounted) {
        dispatch({ type: 'loadSuccess', snapshot: updatedSnapshot })
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [port])

  // 2. Validate tree snapshot
  const validation = useMemo(() => {
    if (!state.snapshot) return null
    return validateTreeSnapshot(state.snapshot)
  }, [state.snapshot])

  // 3. Map to Flow elements and calculate layout
  const { layoutNodes, layoutEdges } = useMemo(() => {
    if (!state.snapshot || !validation?.valid) {
      return { layoutNodes: [], layoutEdges: [] }
    }
    const { nodes, edges } = toFlowElements(
      state.snapshot,
      state.selectedNodeIds,
      highlightedNodeIdSet
    )
    const layoutResult = dagreTreeLayout(nodes, edges)
    return { layoutNodes: layoutResult.nodes, layoutEdges: layoutResult.edges }
  }, [state.snapshot, validation, state.selectedNodeIds, highlightedNodeIdSet])

  // Current node dto
  const currentNode = useMemo(() => {
    if (!state.snapshot) return null
    return state.snapshot.nodes.find((n) => n.id === state.snapshot?.currentNodeId) ?? null
  }, [state.snapshot])

  // Selected nodes dtos
  const selectedNodes = useMemo(() => {
    if (!state.snapshot) return []
    return state.snapshot.nodes.filter((n) => state.selectedNodeIds.has(n.id))
  }, [state.snapshot, state.selectedNodeIds])

  const isEmptyTree = validation?.valid === false && validation.error.code === 'EMPTY_TREE'

  // Action capabilities
  const singleSelected = selectedNodes.length === 1 ? selectedNodes[0] : null
  const canSetCurrent = Boolean(
    singleSelected && singleSelected.id !== state.snapshot?.currentNodeId
  )
  const canAddChild = Boolean(singleSelected)
  const deletableSelectedNodes = selectedNodes.filter((node) => node.id !== state.snapshot?.rootId)
  const protectedRootSelected = deletableSelectedNodes.length !== selectedNodes.length
  const canDelete = deletableSelectedNodes.length > 0

  // Canvas callbacks
  const handleNodeClick = useCallback((nodeId: string, isMulti: boolean) => {
    setActionError(null)
    if (isMulti) {
      dispatch({ type: 'toggleSelect', nodeId })
    } else {
      dispatch({ type: 'selectSingle', nodeId })
    }
  }, [])

  const handlePaneClick = useCallback(() => {
    dispatch({ type: 'clearSelection' })
  }, [])

  const handleSelectionChange = useCallback((nodeIds: string[]) => {
    dispatch({ type: 'setSelection', nodeIds })
  }, [])

  // Toolbar actions
  const handleSetCurrent = useCallback(async () => {
    if (!singleSelected) return
    setActionError(null)
    dispatch({ type: 'actionStart' })
    const res = await port.setCurrentNode(singleSelected.id)
    dispatch({ type: 'actionEnd' })
    if (!res.ok) {
      setActionError(res.error.message)
    }
  }, [port, singleSelected])

  const handleOpenAdd = useCallback(() => {
    if (!singleSelected) return
    setActionError(null)
    dispatch({ type: 'openAddDialog', parentNode: singleSelected })
  }, [singleSelected])

  const handleOpenDelete = useCallback(() => {
    if (!canDelete) return
    setActionError(null)
    dispatch({ type: 'openDeleteDialog', nodesToDelete: deletableSelectedNodes })
  }, [canDelete, deletableSelectedNodes])

  const handleFitView = useCallback(() => {
    canvasRef.current?.fitView()
  }, [])

  const handleFocusCurrent = useCallback(() => {
    if (state.snapshot?.currentNodeId) {
      canvasRef.current?.focusNode(state.snapshot.currentNodeId)
    }
  }, [state.snapshot?.currentNodeId])

  // Dialog actions
  const handleConfirmAdd = useCallback(
    async (role: ConversationNodeRole, content: string) => {
      if (state.dialog.type !== 'add') return
      setActionError(null)
      dispatch({ type: 'actionStart' })
      const res = await port.addChildNode({
        parentId: state.dialog.parentNode.id,
        role,
        content
      })
      dispatch({ type: 'actionEnd' })
      if (res.ok) {
        dispatch({ type: 'closeDialog' })
        setTimeout(() => {
          canvasRef.current?.focusNode(res.value.currentNodeId)
        }, 80)
      } else {
        setActionError(res.error.message)
      }
    },
    [port, state.dialog]
  )

  const handleConfirmDelete = useCallback(async (mode: ConversationTreeDeleteMode) => {
    if (state.dialog.type !== 'delete') return
    setActionError(null)
    dispatch({ type: 'actionStart' })
    const res = await port.deleteNodes({
      nodeIds: state.dialog.nodesToDelete.map((n) => n.id),
      mode
    })
    dispatch({ type: 'actionEnd' })
    if (res.ok) {
      dispatch({ type: 'closeDialog' })
      dispatch({ type: 'clearSelection' })
    } else {
      setActionError(res.error.message)
    }
  }, [port, state.dialog])

  const handleCloseDialog = useCallback(() => {
    dispatch({ type: 'closeDialog' })
  }, [])

  const handleReload = useCallback(async () => {
    dispatch({ type: 'loadStart' })
    const res = await port.reload()
    if (res.ok) {
      dispatch({ type: 'loadSuccess', snapshot: res.value })
    } else {
      dispatch({ type: 'loadError', error: res.error.message })
    }
  }, [port])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || state.actionInProgress) return
      if (state.dialog.type !== 'none') {
        event.preventDefault()
        dispatch({ type: 'closeDialog' })
      } else if (state.selectedNodeIds.size > 0) {
        event.preventDefault()
        dispatch({ type: 'clearSelection' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.actionInProgress, state.dialog.type, state.selectedNodeIds.size])

  return (
    <aside className="session-tree-panel" aria-label="会话树">
      <div className="session-tree-header">
        <h2 className="session-tree-title">会话树</h2>
        {currentNode && (
          <span className="session-tree-subtitle">
            当前: #{currentNode.sequence} ({currentNode.role})
          </span>
        )}
      </div>

      <div className="session-tree-content">
        {state.loading && (
          <div className="tree-state-container">
            <p>加载会话树中...</p>
          </div>
        )}

        {!state.loading && state.error && (
          <div className="tree-state-container">
            <p className="tree-state-title">会话树加载失败</p>
            <p className="tree-state-desc">{state.error}</p>
            <Button type="button" variant="secondary" onClick={handleReload}>
              重试
            </Button>
          </div>
        )}

        {!state.loading && isEmptyTree && (
          <div className="tree-state-container">
            <p className="tree-state-title">暂无会话节点</p>
            <p className="tree-state-desc">当前会话树为空，接入对话内核后会在此显示节点。</p>
            <Button type="button" variant="secondary" onClick={handleReload}>
              刷新
            </Button>
          </div>
        )}

        {!state.loading && validation && !validation.valid && !isEmptyTree && (
          <div className="tree-state-container">
            <p className="tree-state-title">会话树结构异常</p>
            <p className="tree-state-desc">{validation.error.message}</p>
            <Button type="button" variant="secondary" onClick={handleReload}>
              刷新重试
            </Button>
          </div>
        )}

        {!state.loading && validation?.valid && (
          <>
            <ConversationTreeToolbar
              selectedCount={state.selectedNodeIds.size}
              protectedRootSelected={protectedRootSelected}
              canSetCurrent={canSetCurrent}
              canAddChild={canAddChild}
              canDelete={canDelete}
              isActionInProgress={state.actionInProgress}
              onSetCurrent={handleSetCurrent}
              onAddChild={handleOpenAdd}
              onDelete={handleOpenDelete}
              onFitView={handleFitView}
              onFocusCurrent={handleFocusCurrent}
            />

            {actionError && (
              <div className="tree-action-error-wrapper">
                <StatusNotice type="danger" message={actionError} />
              </div>
            )}

            <ConversationTreeCanvas
              ref={canvasRef}
              nodes={layoutNodes}
              edges={layoutEdges}
              currentNodeId={state.snapshot?.currentNodeId ?? ''}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              onSelectionChange={handleSelectionChange}
            />
          </>
        )}

        {state.dialog.type === 'add' && (
          <ConversationTreeMutationDialog
            type="add"
            parentNode={state.dialog.parentNode}
            onConfirm={handleConfirmAdd}
            onCancel={handleCloseDialog}
            isSubmitting={state.actionInProgress}
          />
        )}

        {state.dialog.type === 'delete' && (
          <ConversationTreeMutationDialog
            type="delete"
            snapshot={state.snapshot as NonNullable<typeof state.snapshot>}
            nodesToDelete={state.dialog.nodesToDelete}
            onConfirm={handleConfirmDelete}
            onCancel={handleCloseDialog}
            isSubmitting={state.actionInProgress}
          />
        )}
      </div>
    </aside>
  )
}
