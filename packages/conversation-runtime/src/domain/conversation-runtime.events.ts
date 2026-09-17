import type {
  ConversationNodeId,
  ConversationTreeId
} from 'chat-conversation-tree'
import type { ConversationRuntimeError } from './conversation-runtime.errors.js'

export type ConversationTurnEvent =
  | {
      readonly type: 'conversation.turn.started'
      readonly treeId: ConversationTreeId
      readonly requestId: string
      readonly userNodeId: ConversationNodeId
    }
  | {
      readonly type: 'conversation.turn.delta'
      readonly treeId: ConversationTreeId
      readonly requestId: string
      readonly userNodeId: ConversationNodeId
      readonly assistantNodeId: ConversationNodeId
      readonly sequence: number
      readonly delta: string
    }
  | {
      readonly type: 'conversation.turn.completed'
      readonly treeId: ConversationTreeId
      readonly requestId: string
      readonly userNodeId: ConversationNodeId
      readonly assistantNodeId: ConversationNodeId
      readonly currentNodeId: ConversationNodeId
      readonly finishReason: 'stop' | 'length' | 'unknown'
      readonly treeVersion: number
    }
  | {
      readonly type: 'conversation.turn.failed'
      readonly treeId: ConversationTreeId
      readonly requestId: string
      readonly userNodeId: ConversationNodeId
      readonly error: ConversationRuntimeError
    }
  | {
      readonly type: 'conversation.turn.cancelled'
      readonly treeId: ConversationTreeId
      readonly requestId: string
      readonly userNodeId: ConversationNodeId
    }

export interface ConversationTurnEventSink {
  emit(event: ConversationTurnEvent): void
}
