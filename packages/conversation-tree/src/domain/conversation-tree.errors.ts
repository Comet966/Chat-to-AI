export type ConversationTreeErrorCode =
  | 'TREE_NOT_FOUND'
  | 'TREE_ALREADY_EXISTS'
  | 'NODE_NOT_FOUND'
  | 'DUPLICATE_NODE_ID'
  | 'PARENT_NOT_FOUND'
  | 'NODE_HAS_CHILDREN'
  | 'ROOT_DELETE_REQUIRES_TREE_DELETE'
  | 'INVALID_ROOT_COUNT'
  | 'ROOT_ID_MISMATCH'
  | 'TREE_ID_MISMATCH'
  | 'DISCONNECTED_NODE'
  | 'CYCLE_DETECTED'
  | 'INVALID_SEQUENCE'
  | 'INVALID_DELETE_MODE'
  | 'INVALID_NODE_ROLE'
  | 'INVALID_NODE_CONTENT'
  | 'INVALID_GENERATION_PROVENANCE'
  | 'INVALID_SNAPSHOT_METADATA'
  | 'VERSION_CONFLICT'
  | 'UNSUPPORTED_SNAPSHOT_VERSION'
  | 'IMMUTABLE_FIELD'

export interface ConversationTreeError {
  readonly code: ConversationTreeErrorCode
  readonly message: string
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

export function createTreeError(
  code: ConversationTreeErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>
): ConversationTreeError {
  return {
    code,
    message,
    ...(details ? { details } : {})
  }
}
