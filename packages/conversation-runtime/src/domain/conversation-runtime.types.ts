import type {
  ConversationNodeId,
  ConversationTreeId
} from 'chat-conversation-tree'
import type { ModelExecutionDescriptor } from '../ports/streaming-chat-executor.port.js'
import type { ConversationRuntimeError } from './conversation-runtime.errors.js'

export interface ConversationCursor {
  readonly treeId: ConversationTreeId
  readonly currentNodeId: ConversationNodeId
}

export interface CompletedConversationTurn {
  readonly treeId: ConversationTreeId
  readonly requestId: string
  readonly baseNodeId: ConversationNodeId | null
  readonly userNodeId: ConversationNodeId
  readonly assistantNodeId: ConversationNodeId
  readonly currentNodeId: ConversationNodeId
  readonly finishReason: 'stop' | 'length' | 'unknown'
  readonly treeVersion: number
}

export type ConversationRuntimeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConversationRuntimeError }

export type ConversationContextSelection =
  | { readonly mode: 'root-path' }
  | {
      readonly mode: 'explicit-nodes'
      /** Ordered historical message node IDs. The current prompt is appended by the runtime. */
      readonly nodeIds: readonly ConversationNodeId[]
    }

export interface SendConversationMessageCommand {
  readonly treeId: ConversationTreeId
  readonly prompt: string
  /** Controls context construction independently from the node used as the new branch parent. */
  readonly contextSelection?: ConversationContextSelection
  readonly selectedNodeId?: ConversationNodeId
  readonly model: ModelExecutionDescriptor
}

export interface SelectConversationNodeCommand {
  readonly treeId: ConversationTreeId
  readonly nodeId: ConversationNodeId
}

export interface CancelConversationTurnCommand {
  readonly treeId: ConversationTreeId
}
