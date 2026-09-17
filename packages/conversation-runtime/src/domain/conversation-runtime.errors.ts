export type ConversationRuntimeErrorCode =
  | 'TREE_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'TURN_IN_PROGRESS'
  | 'INVALID_PROMPT'
  | 'CONTEXT_LIMIT_EXCEEDED'
  | 'MODEL_REQUEST_REJECTED'
  | 'MODEL_REQUEST_FAILED'
  | 'MODEL_REQUEST_CANCELLED'
  | 'EMPTY_MODEL_RESPONSE'
  | 'TREE_VERSION_CONFLICT'
  | 'ASSISTANT_PERSIST_FAILED'
  | 'INTERNAL_ERROR'

export interface ConversationRuntimeError {
  readonly code: ConversationRuntimeErrorCode
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export function createRuntimeError(
  code: ConversationRuntimeErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>
): ConversationRuntimeError {
  return {
    code,
    message,
    ...(details ? { details } : {})
  }
}
