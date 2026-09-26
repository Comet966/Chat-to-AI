import type {
  ConversationTreeAction,
  ConversationTreeState
} from './conversation-tree-ui.types.js'

export const initialConversationTreeState: ConversationTreeState = {
  snapshot: null,
  loading: true,
  error: null,
  selectedNodeIds: new Set<string>(),
  inheritanceMode: 'root-path',
  manualInheritanceNodeIds: new Set<string>(),
  actionInProgress: false,
  dialog: { type: 'none' }
}

export function conversationTreeReducer(
  state: ConversationTreeState,
  action: ConversationTreeAction
): ConversationTreeState {
  switch (action.type) {
    case 'loadStart':
      return {
        ...state,
        loading: true,
        error: null
      }

    case 'loadSuccess': {
      // Retain selections that still exist in the new snapshot
      const existingIds = new Set(action.snapshot.nodes.map((n) => n.id))
      const nextSelection = new Set<string>()
      const nextManualInheritance = new Set<string>()
      for (const id of state.selectedNodeIds) {
        if (existingIds.has(id)) {
          nextSelection.add(id)
        }
      }
      for (const id of state.manualInheritanceNodeIds) {
        if (existingIds.has(id)) nextManualInheritance.add(id)
      }

      return {
        ...state,
        snapshot: action.snapshot,
        loading: false,
        error: null,
        selectedNodeIds: nextSelection,
        manualInheritanceNodeIds: nextManualInheritance
      }
    }

    case 'loadError':
      return {
        ...state,
        loading: false,
        error: action.error
      }

    case 'selectSingle':
      return {
        ...state,
        selectedNodeIds: new Set([action.nodeId])
      }

    case 'toggleSelect': {
      const next = new Set(state.selectedNodeIds)
      if (next.has(action.nodeId)) {
        next.delete(action.nodeId)
      } else {
        next.add(action.nodeId)
      }
      return {
        ...state,
        selectedNodeIds: next
      }
    }

    case 'setSelection':
      return {
        ...state,
        selectedNodeIds: new Set(action.nodeIds)
      }

    case 'clearSelection':
      return {
        ...state,
        selectedNodeIds: new Set<string>()
      }

    case 'setInheritanceMode':
      return {
        ...state,
        inheritanceMode: action.mode
      }

    case 'toggleManualInheritance': {
      const next = new Set(state.manualInheritanceNodeIds)
      if (next.has(action.nodeId)) next.delete(action.nodeId)
      else next.add(action.nodeId)
      return {
        ...state,
        manualInheritanceNodeIds: next
      }
    }

    case 'openAddDialog':
      return {
        ...state,
        dialog: { type: 'add', parentNode: action.parentNode }
      }

    case 'openDeleteDialog':
      return {
        ...state,
        dialog: { type: 'delete', nodesToDelete: action.nodesToDelete }
      }

    case 'closeDialog':
      return {
        ...state,
        dialog: { type: 'none' }
      }

    case 'actionStart':
      return {
        ...state,
        actionInProgress: true
      }

    case 'actionEnd':
      return {
        ...state,
        actionInProgress: false
      }

    default:
      return state
  }
}
