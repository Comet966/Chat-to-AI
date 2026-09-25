export type ConversationNodeRole = 'system' | 'user' | 'assistant'

export interface ConversationNodeProviderInfo {
  provider: string
  modelId: string
}

export interface ConversationTreeNodeDto {
  id: string
  parentId: string | null
  role: ConversationNodeRole
  content: string
  sequence: number
  createdAt: string
  providerInfo?: ConversationNodeProviderInfo
}

export interface ConversationTreeSnapshot {
  treeId: string
  revision: number
  rootId: string
  currentNodeId: string
  nodes: ConversationTreeNodeDto[]
}

export type ConversationTreeErrorCode =
  | 'VALIDATION_FAILED'
  | 'NODE_NOT_FOUND'
  | 'ROOT_NODE_PROTECTED'
  | 'CANNOT_DELETE_ACTIVE'
  | 'INVARIANT_VIOLATION'
  | 'INTERNAL_ERROR'

export interface ConversationTreeError {
  code: ConversationTreeErrorCode
  message: string
  nodeId?: string
}

export type ConversationTreeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConversationTreeError }

export interface AddChildNodeInput {
  parentId: string
  role: ConversationNodeRole
  content: string
  providerInfo?: ConversationNodeProviderInfo
}

export type ConversationTreeDeleteMode = 'leaf-only' | 'subtree'

export interface DeleteNodesInput {
  nodeIds: string[]
  /** The operation is explicit so a future IPC adapter cannot silently choose destructive semantics. */
  mode: ConversationTreeDeleteMode
}

export interface ConversationTreeUiPort {
  getSnapshot(): Promise<ConversationTreeResult<ConversationTreeSnapshot>>
  subscribe(listener: (snapshot: ConversationTreeSnapshot) => void): () => void
  setCurrentNode(nodeId: string): Promise<ConversationTreeResult<ConversationTreeSnapshot>>
  addChildNode(input: AddChildNodeInput): Promise<ConversationTreeResult<ConversationTreeSnapshot>>
  deleteNodes(input: DeleteNodesInput): Promise<ConversationTreeResult<ConversationTreeSnapshot>>
  reload(): Promise<ConversationTreeResult<ConversationTreeSnapshot>>
}
