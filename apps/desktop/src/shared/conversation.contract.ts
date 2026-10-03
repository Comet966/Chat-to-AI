export interface ConversationTurnProviderInfoDto {
  provider: string
  modelId: string
}

export interface ConversationTurnDto {
  id: string
  parentId: string | null
  question: string
  answer: string
  /** Stable zero-based ordinal among completed question/answer turns. */
  sequence: number
  createdAt: string
  providerInfo?: ConversationTurnProviderInfoDto
}

export interface ConversationSnapshotDto {
  treeId: string
  revision: number
  rootTurnId: string | null
  currentTurnId: string | null
  turns: readonly ConversationTurnDto[]
}

export type ConversationContextSelectionDto =
  | { mode: 'root-path'; turnIds: readonly string[] }
  | { mode: 'manual'; turnIds: readonly string[] }

export interface StartConversationTurnInput {
  prompt: string
  expectedRevision: number
  currentTurnId: string | null
  contextSelection: ConversationContextSelectionDto
}

export type DesktopConversationErrorCode =
  | 'NOT_CONFIGURED'
  | 'TREE_NOT_FOUND'
  | 'TURN_NOT_FOUND'
  | 'TURN_IN_PROGRESS'
  | 'VERSION_CONFLICT'
  | 'INVALID_CONTEXT_SELECTION'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED_SENDER'
  | 'MODEL_REQUEST_FAILED'
  | 'CANCELLED'
  | 'INTERNAL_ERROR'

export interface DesktopConversationError {
  code: DesktopConversationErrorCode
  message: string
}

export type DesktopConversationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopConversationError }

export interface ConversationTurnAcceptedDto {
  requestId: string
}

export interface SetCurrentConversationTurnInput {
  turnId: string
  expectedRevision: number
}

export type DesktopConversationEvent =
  | {
      type: 'conversation.turn.started'
      schemaVersion: 1
      requestId: string
      treeId: string
    }
  | {
      type: 'conversation.turn.delta'
      schemaVersion: 1
      requestId: string
      treeId: string
      sequence: number
      delta: string
    }
  | {
      type: 'conversation.turn.completed'
      schemaVersion: 1
      requestId: string
      treeId: string
      finishReason: 'stop' | 'length' | 'unknown'
    }
  | {
      type: 'conversation.turn.failed'
      schemaVersion: 1
      requestId: string
      treeId: string
      error: DesktopConversationError
    }
  | {
      type: 'conversation.turn.cancelled'
      schemaVersion: 1
      requestId: string
      treeId: string
    }
  | {
      type: 'conversation.snapshot.changed'
      schemaVersion: 1
      treeId: string
      snapshot: ConversationSnapshotDto
    }

export interface DesktopConversationEventSink {
  emit(event: DesktopConversationEvent): void
}
