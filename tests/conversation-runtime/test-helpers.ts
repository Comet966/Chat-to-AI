import type {
  CancelChatCommand,
  CancelChatResult,
  ChatEvent,
  StartChatCommand,
  StartChatResult
} from 'chat-contracts'
import type {
  StreamingChatEventSink,
  StreamingChatExecutor
} from '../../packages/conversation-runtime/src/ports/streaming-chat-executor.port.js'

export type ScriptedAction =
  | { type: 'started' }
  | { type: 'delta'; text: string }
  | { type: 'completed'; finishReason?: 'stop' | 'length' | 'unknown' }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string; code?: string }

export class ScriptedStreamingChatExecutor implements StreamingChatExecutor {
  public lastReceivedCommand?: StartChatCommand
  public cancelCalled = false

  constructor(
    private readonly actions: ScriptedAction[] = [
      { type: 'started' },
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'completed', finishReason: 'stop' }
    ],
    private readonly shouldReject = false,
    private readonly rejectionMessage = 'Start rejected'
  ) {}

  public async start(
    command: StartChatCommand,
    sink: StreamingChatEventSink
  ): Promise<StartChatResult> {
    this.lastReceivedCommand = command

    if (this.shouldReject) {
      return {
        requestId: command.requestId,
        accepted: false,
        error: {
          code: 'INVALID_REQUEST',
          message: this.rejectionMessage,
          retryable: false
        }
      }
    }

    // Play actions asynchronously
    queueMicrotask(() => {
      let sequence = 0
      const now = new Date().toISOString()

      for (const action of this.actions) {
        if (action.type === 'started') {
          sink.emit({
            type: 'chat.stream.started',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            emittedAt: now
          })
        } else if (action.type === 'delta') {
          sink.emit({
            type: 'chat.stream.delta',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            sequence: sequence++,
            delta: action.text,
            emittedAt: now
          })
        } else if (action.type === 'completed') {
          sink.emit({
            type: 'chat.stream.completed',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            finishReason: action.finishReason ?? 'stop',
            emittedAt: now
          })
        } else if (action.type === 'cancelled') {
          sink.emit({
            type: 'chat.stream.cancelled',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            emittedAt: now
          })
        } else if (action.type === 'failed') {
          sink.emit({
            type: 'chat.stream.failed',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            error: {
              code: (action.code as any) ?? 'UNKNOWN',
              message: action.message,
              retryable: false
            },
            emittedAt: now
          })
        }
      }
    })

    return {
      requestId: command.requestId,
      accepted: true
    }
  }

  public async cancel(command: CancelChatCommand): Promise<CancelChatResult> {
    this.cancelCalled = true
    return {
      requestId: command.requestId,
      cancelled: true
    }
  }
}

export class DeferredStreamingChatExecutor implements StreamingChatExecutor {
  public lastReceivedCommand?: StartChatCommand
  public activeSink?: StreamingChatEventSink
  public cancelCalled = false
  public sequence = 0

  public async start(
    command: StartChatCommand,
    sink: StreamingChatEventSink
  ): Promise<StartChatResult> {
    this.lastReceivedCommand = command
    this.activeSink = sink
    this.sequence = 0
    return {
      requestId: command.requestId,
      accepted: true
    }
  }

  public emitStarted(): void {
    if (!this.lastReceivedCommand || !this.activeSink) return
    this.activeSink.emit({
      type: 'chat.stream.started',
      requestId: this.lastReceivedCommand.requestId,
      conversationId: this.lastReceivedCommand.conversationId,
      assistantMessageId: this.lastReceivedCommand.assistantMessageId,
      emittedAt: new Date().toISOString()
    })
  }

  public emitDelta(delta: string): void {
    if (!this.lastReceivedCommand || !this.activeSink) return
    this.activeSink.emit({
      type: 'chat.stream.delta',
      requestId: this.lastReceivedCommand.requestId,
      conversationId: this.lastReceivedCommand.conversationId,
      assistantMessageId: this.lastReceivedCommand.assistantMessageId,
      sequence: this.sequence++,
      delta,
      emittedAt: new Date().toISOString()
    })
  }

  public emitCompleted(finishReason: 'stop' | 'length' | 'unknown' = 'stop'): void {
    if (!this.lastReceivedCommand || !this.activeSink) return
    this.activeSink.emit({
      type: 'chat.stream.completed',
      requestId: this.lastReceivedCommand.requestId,
      conversationId: this.lastReceivedCommand.conversationId,
      assistantMessageId: this.lastReceivedCommand.assistantMessageId,
      finishReason,
      emittedAt: new Date().toISOString()
    })
  }

  public emitFailed(message: string, code = 'UNKNOWN'): void {
    if (!this.lastReceivedCommand || !this.activeSink) return
    this.activeSink.emit({
      type: 'chat.stream.failed',
      requestId: this.lastReceivedCommand.requestId,
      conversationId: this.lastReceivedCommand.conversationId,
      assistantMessageId: this.lastReceivedCommand.assistantMessageId,
      error: {
        code: code as any,
        message,
        retryable: false
      },
      emittedAt: new Date().toISOString()
    })
  }

  public emitCancelled(): void {
    if (!this.lastReceivedCommand || !this.activeSink) return
    this.activeSink.emit({
      type: 'chat.stream.cancelled',
      requestId: this.lastReceivedCommand.requestId,
      conversationId: this.lastReceivedCommand.conversationId,
      assistantMessageId: this.lastReceivedCommand.assistantMessageId,
      emittedAt: new Date().toISOString()
    })
  }

  public async cancel(command: CancelChatCommand): Promise<CancelChatResult> {
    this.cancelCalled = true
    this.emitCancelled()
    return {
      requestId: command.requestId,
      cancelled: true
    }
  }
}
