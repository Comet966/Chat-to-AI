import type {
  CancelChatCommand,
  CancelChatResult,
  ChatEvent,
  StartChatCommand,
  StartChatResult
} from 'chat-contracts'

export interface StreamingChatEventSink {
  emit(event: ChatEvent): void
}

export interface StreamingChatExecutor {
  start(command: StartChatCommand, sink: StreamingChatEventSink): Promise<StartChatResult>
  cancel(command: CancelChatCommand): Promise<CancelChatResult>
}

export interface ModelExecutionDescriptor {
  readonly providerId: string
  readonly modelId: string
  readonly executor: StreamingChatExecutor
}
