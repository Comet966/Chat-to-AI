import type {
  CancelChatCommand,
  CancelChatResult,
  ChatPublicError,
  ConversationId,
  MessageId,
  MessageNode,
  StartChatCommand,
  StartChatResult
} from 'chat-contracts'
import { StartChatCommandSchema } from 'chat-contracts'
import { toPublicModelError } from './model-error.js'
import { ChatRequestRegistry } from './chat-request.registry.js'
import type { ChatEventSink } from './ports/chat-event.sink.js'
import type { ChatModelPort } from './ports/chat-model.port.js'

export interface ChatKernelState {
  conversationId: ConversationId
  messages: MessageNode[]
  activeRequestId: string | null
  lastSequence: number
}

export class ChatKernel {
  private readonly model: ChatModelPort
  private readonly registry: ChatRequestRegistry
  private conversationId: ConversationId = ''
  private messages: MessageNode[] = []
  private lastSequence = 0

  constructor(model: ChatModelPort) {
    this.model = model
    this.registry = new ChatRequestRegistry()
  }

  public getState(): ChatKernelState {
    return {
      conversationId: this.conversationId,
      messages: structuredClone(this.messages),
      activeRequestId: this.registry.getActiveRequestId(),
      lastSequence: this.lastSequence
    }
  }

  public async start(command: StartChatCommand, sink: ChatEventSink): Promise<StartChatResult> {
    const validation = StartChatCommandSchema.safeParse(command)
    if (!validation.success) {
      return {
        requestId: command?.requestId ?? '',
        accepted: false,
        error: { code: 'INVALID_REQUEST', message: validation.error.issues[0].message, retryable: false }
      }
    }
    // Snapshot caller-owned input before asynchronous streaming begins.
    command = validation.data

    if (this.registry.hasActiveRequest()) {
      return {
        requestId: command.requestId,
        accepted: false,
        error: {
          code: 'REQUEST_IN_PROGRESS',
          message: 'A chat request is already in progress',
          retryable: true
        }
      }
    }

    const abortController = new AbortController()
    const registered = this.registry.register({
      requestId: command.requestId,
      conversationId: command.conversationId,
      assistantMessageId: command.assistantMessageId,
      abortController,
      sink
    })

    if (!registered) {
      return {
        requestId: command.requestId,
        accepted: false,
        error: {
          code: 'REQUEST_IN_PROGRESS',
          message: 'Failed to acquire lock for chat request',
          retryable: true
        }
      }
    }

    this.conversationId = command.conversationId
    this.syncMessagesFromCommand(command)

    // Run streaming execution asynchronously
    queueMicrotask(() => {
      this.executeStream(command, abortController, sink)
    })

    return {
      requestId: command.requestId,
      accepted: true
    }
  }

  public async cancel(command: CancelChatCommand): Promise<CancelChatResult> {
    const activeId = this.registry.getActiveRequestId()
    if (!activeId || activeId !== command.requestId) {
      return {
        requestId: command.requestId,
        cancelled: false
      }
    }

    const didAbort = this.registry.abort(command.requestId)
    return {
      requestId: command.requestId,
      cancelled: didAbort
    }
  }

  private syncMessagesFromCommand(command: StartChatCommand): void {
    const newNodes: MessageNode[] = []
    let previousId: MessageId | null = null

    for (let i = 0; i < command.messages.length; i++) {
      const msg = command.messages[i]
      const existing = this.messages[i]
      const id = existing?.id ?? `msg-${i}-${Date.now()}`
      const node: MessageNode = {
        id,
        conversationId: command.conversationId,
        parentId: previousId,
        role: msg.role,
        content: msg.content,
        ...(msg.attachments ? { attachments: msg.attachments } : {}),
        status: 'complete',
        createdAt: existing?.createdAt ?? new Date().toISOString()
      }
      newNodes.push(node)
      previousId = id
    }

    // Add assistant streaming placeholder node
    const assistantNode: MessageNode = {
      id: command.assistantMessageId,
      conversationId: command.conversationId,
      parentId: previousId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
      modelId: this.model.modelId
    }
    newNodes.push(assistantNode)

    this.messages = newNodes
  }

  private updateAssistantMessage(id: MessageId, content: string, status: 'complete' | 'streaming' | 'failed' | 'cancelled'): void {
    const node = this.messages.find((m) => m.id === id)
    if (node) {
      node.content = content
      node.status = status
    }
  }

  private async executeStream(command: StartChatCommand, abortController: AbortController, sink: ChatEventSink): Promise<void> {
    const now = () => new Date().toISOString()
    let accumulatedText = ''

    sink.emit({
      type: 'chat.stream.started',
      requestId: command.requestId,
      conversationId: command.conversationId,
      assistantMessageId: command.assistantMessageId,
      emittedAt: now()
    })

    try {
      const stream = this.model.streamChat({ messages: command.messages }, abortController.signal)

      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          break
        }

        if (chunk.type === 'text-delta') {
          const sequence = this.registry.nextSequence(command.requestId)
          if (sequence === null) {
            break
          }
          accumulatedText += chunk.text
          this.lastSequence = sequence
          this.updateAssistantMessage(command.assistantMessageId, accumulatedText, 'streaming')

          sink.emit({
            type: 'chat.stream.delta',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            sequence,
            delta: chunk.text,
            emittedAt: now()
          })
        } else if (chunk.type === 'finish') {
          if (this.registry.markTerminal(command.requestId)) {
            this.updateAssistantMessage(command.assistantMessageId, accumulatedText, 'complete')
            sink.emit({
              type: 'chat.stream.completed',
              requestId: command.requestId,
              conversationId: command.conversationId,
              assistantMessageId: command.assistantMessageId,
              finishReason: chunk.finishReason,
              emittedAt: now()
            })
          }
          return
        }
      }

      if (abortController.signal.aborted) {
        if (this.registry.markTerminal(command.requestId)) {
          this.updateAssistantMessage(command.assistantMessageId, accumulatedText, 'cancelled')
          sink.emit({
            type: 'chat.stream.cancelled',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            emittedAt: now()
          })
        }
      } else {
        if (this.registry.markTerminal(command.requestId)) {
          this.updateAssistantMessage(command.assistantMessageId, accumulatedText, 'complete')
          sink.emit({
            type: 'chat.stream.completed',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            finishReason: 'stop',
            emittedAt: now()
          })
        }
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        if (this.registry.markTerminal(command.requestId)) {
          this.updateAssistantMessage(command.assistantMessageId, accumulatedText, 'cancelled')
          sink.emit({
            type: 'chat.stream.cancelled',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            emittedAt: now()
          })
        }
      } else {
        if (this.registry.markTerminal(command.requestId)) {
          this.updateAssistantMessage(command.assistantMessageId, accumulatedText, 'failed')
          const publicError = this.mapToPublicError(err)
          sink.emit({
            type: 'chat.stream.failed',
            requestId: command.requestId,
            conversationId: command.conversationId,
            assistantMessageId: command.assistantMessageId,
            error: publicError,
            emittedAt: now()
          })
        }
      }
    } finally {
      this.registry.clear(command.requestId)
    }
  }

  private mapToPublicError(err: unknown): ChatPublicError {
    return toPublicModelError(err)
  }
}
