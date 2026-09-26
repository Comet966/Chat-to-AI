import type {
  ConversationTreeNodeDto,
  ConversationTreeSnapshot
} from '../../ports/conversation-tree-ui.port.js'

export interface ConversationTreeState {
  snapshot: ConversationTreeSnapshot | null
  loading: boolean
  error: string | null
  selectedNodeIds: Set<string>
  actionInProgress: boolean
  dialog:
    | { type: 'none' }
    | { type: 'add'; parentNode: ConversationTreeNodeDto }
    | { type: 'delete'; nodesToDelete: ConversationTreeNodeDto[] }
}

export type ConversationTreeAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; snapshot: ConversationTreeSnapshot }
  | { type: 'loadError'; error: string }
  | { type: 'selectSingle'; nodeId: string }
  | { type: 'toggleSelect'; nodeId: string }
  | { type: 'setSelection'; nodeIds: string[] }
  | { type: 'clearSelection' }
  | { type: 'openAddDialog'; parentNode: ConversationTreeNodeDto }
  | { type: 'openDeleteDialog'; nodesToDelete: ConversationTreeNodeDto[] }
  | { type: 'closeDialog' }
  | { type: 'actionStart' }
  | { type: 'actionEnd' }
