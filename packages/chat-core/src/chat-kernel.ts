import type {
  CancelChatCommand,
  CancelChatResult,
  ChatErrorCode,
  ChatPublicError,
  ConversationId,
  MessageId,
  MessageNode,
  StartChatCommand,
  StartChatResult
} from 'chat-contracts'
import { ChatRequestRegistry } from './chat-request.registry.js'
import type { ChatEventSink } from './ports/chat-event.sink.js'
import type { ChatModelPort } from './ports/chat-model.port.js'

const MAX_MESSAGES_COUNT = 100
const MAX_SINGLE_MESSAGE_LENGTH = 32000
const MAX_TOTAL_MESSAGES_LENGTH = 100000

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
      messages: [...this.messages],
      activeRequestId: this.registry.getActiveRequestId(),
      lastSequence: this.lastSequence
    }
  }

  public async start(command: StartChatCommand, sink: ChatEventSink): Promise<StartChatResult> {
    const validationError = this.validateCommand(command)
    if (validationError) {
      return {
        requestId: command.requestId,
        accepted: false,
        error: validationError
      }
    }

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

  private validateCommand(command: StartChatCommand): ChatPublicError | null {
    if (!command.requestId || typeof command.requestId !== 'string') {
      return { code: 'INVALID_REQUEST', message: 'Missing or invalid requestId', retryable: false }
    }
    if (!command.conversationId || typeof command.conversationId !== 'string') {
      return { code: 'INVALID_REQUEST', message: 'Missing or invalid conversationId', retryable: false }
    }
    if (!command.assistantMessageId || typeof command.assistantMessageId !== 'string') {
      return { code: 'INVALID_REQUEST', message: 'Missing or invalid assistantMessageId', retryable: false }
    }
    if (!Array.isArray(command.messages) || command.messages.length === 0) {
      return { code: 'INVALID_REQUEST', message: 'Messages list cannot be empty', retryable: false }
    }
    if (command.messages.length > MAX_MESSAGES_COUNT) {
      return {
        code: 'INVALID_REQUEST',
        message: `Message count cannot exceed ${MAX_MESSAGES_COUNT}`,
        retryable: false
      }
    }

    const lastMessage = command.messages[command.messages.length - 1]
    if (lastMessage.role !== 'user' || !lastMessage.content || lastMessage.content.trim().length === 0) {
      return {
        code: 'INVALID_REQUEST',
        message: 'The last message in context must be a non-empty user message',
        retryable: false
      }
    }

    let totalChars = 0
    for (const msg of command.messages) {
      if (!msg.content || typeof msg.content !== 'string') {
        return { code: 'INVALID_REQUEST', message: 'Message content must be a non-empty string', retryable: false }
      }
      if (msg.content.length > MAX_SINGLE_MESSAGE_LENGTH) {
        return {
          code: 'INVALID_REQUEST',
          message: `Single message length cannot exceed ${MAX_SINGLE_MESSAGE_LENGTH} characters`,
          retryable: false
        }
      }
      totalChars += msg.content.length
    }

    if (totalChars > MAX_TOTAL_MESSAGES_LENGTH) {
      return {
        code: 'INVALID_REQUEST',
        message: `Total messages length exceeds limit of ${MAX_TOTAL_MESSAGES_LENGTH} characters`,
        retryable: false
      }
    }

    return null
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
    if (err && typeof err === 'object') {
      const maybeError = err as { name?: string; code?: string; status?: number; statusCode?: number }
      if (maybeError.name === 'AbortError') {
        return {
          code: 'REQUEST_ABORTED',
          message: 'The chat stream was aborted',
          retryable: true
        }
      }
      const status = maybeError.status || maybeError.statusCode
      if (status === 401 || status === 403) {
        return {
          code: 'PROVIDER_UNAUTHORIZED',
          message: 'Model provider authentication failed',
          retryable: false
        }
      }
      if (status === 429) {
        return {
          code: 'PROVIDER_RATE_LIMITED',
          message: 'Model provider rate limit exceeded',
          retryable: true
        }
      }
      if (status && status >= 500 && status < 600) {
        return {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Model provider service is temporarily unavailable',
          retryable: true
        }
      }
      if (maybeError.code === 'ECONNREFUSED' || maybeError.code === 'ENOTFOUND') {
        return {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Network connection to model provider failed',
          retryable: true
        }
      }
    }

    return {
      code: 'UNKNOWN',
      message: 'An unexpected error occurred while generating the model response',
      retryable: true
    }
  }
}
