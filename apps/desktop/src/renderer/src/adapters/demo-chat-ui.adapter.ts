import type {
  ChatUiMessage,
  ChatUiPort,
  ChatUiResult,
  ChatUiState
} from '../ports/chat-ui.port.js'

export class DemoChatUiAdapter implements ChatUiPort {
  private state: ChatUiState
  private listeners: Set<(state: ChatUiState) => void> = new Set()
  private cancelRequested = false

  constructor(initialMessages: ChatUiMessage[] = []) {
    this.state = {
      status: 'idle',
      messages: initialMessages,
      error: null
    }
  }

  public getState(): ChatUiState {
    return { ...this.state, messages: [...this.state.messages] }
  }

  public subscribe(listener: (state: ChatUiState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(partial: Partial<ChatUiState>): void {
    this.state = { ...this.state, ...partial }
    const snapshot = this.getState()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  public async sendMessage(content: string): Promise<ChatUiResult<void>> {
    const trimmed = content.trim()
    if (!trimmed) {
      return {
        ok: false,
        error: { code: 'EMPTY_INPUT', message: 'Message cannot be empty' }
      }
    }

    this.cancelRequested = false
    const userMessage: ChatUiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString()
    }

    this.setState({
      status: 'submitting-demo',
      messages: [...this.state.messages, userMessage],
      error: null
    })

    // Simulate async turn
    await new Promise((resolve) => setTimeout(resolve, 50))

    if (this.cancelRequested) {
      this.setState({ status: 'cancelled' })
      return {
        ok: false,
        error: { code: 'CANCELLED', message: 'Operation was cancelled' }
      }
    }

    const assistantMessage: ChatUiMessage = {
      id: `asst-${Date.now()}`,
      role: 'assistant',
      content: `[UI Preview] Backend not connected. Your message: "${trimmed}" was received by demo adapter.`,
      timestamp: new Date().toISOString(),
      isDemo: true
    }

    this.setState({
      status: 'demo-completed',
      messages: [...this.state.messages, assistantMessage]
    })

    return { ok: true, value: undefined }
  }

  public async cancel(): Promise<void> {
    this.cancelRequested = true
    if (this.state.status === 'submitting-demo') {
      this.setState({ status: 'cancelled' })
    }
  }
}
