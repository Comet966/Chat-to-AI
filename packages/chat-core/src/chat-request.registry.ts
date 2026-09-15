import type { ChatEventSink } from './ports/chat-event.sink.js'

export interface ActiveChatRequest {
  readonly requestId: string
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly abortController: AbortController
  readonly sink: ChatEventSink
  sequence: number
  isTerminal: boolean
}

export class ChatRequestRegistry {
  private currentRequest: ActiveChatRequest | null = null

  public hasActiveRequest(): boolean {
    return this.currentRequest !== null && !this.currentRequest.isTerminal
  }

  public getActiveRequestId(): string | null {
    return this.currentRequest?.requestId ?? null
  }

  public getActiveRequest(): ActiveChatRequest | null {
    return this.currentRequest
  }

  public register(request: Omit<ActiveChatRequest, 'sequence' | 'isTerminal'>): boolean {
    if (this.hasActiveRequest()) {
      return false
    }
    this.currentRequest = {
      ...request,
      sequence: 0,
      isTerminal: false
    }
    return true
  }

  public nextSequence(requestId: string): number | null {
    if (this.currentRequest?.requestId !== requestId || this.currentRequest.isTerminal) {
      return null
    }
    const current = this.currentRequest.sequence
    this.currentRequest.sequence += 1
    return current
  }

  public markTerminal(requestId: string): boolean {
    if (this.currentRequest?.requestId !== requestId) {
      return false
    }
    if (this.currentRequest.isTerminal) {
      return false
    }
    this.currentRequest.isTerminal = true
    return true
  }

  public abort(requestId: string): boolean {
    if (this.currentRequest?.requestId !== requestId) {
      return false
    }
    if (!this.currentRequest.abortController.signal.aborted) {
      this.currentRequest.abortController.abort()
      return true
    }
    return false
  }

  public clear(requestId: string): void {
    if (this.currentRequest?.requestId === requestId) {
      this.currentRequest = null
    }
  }
}
