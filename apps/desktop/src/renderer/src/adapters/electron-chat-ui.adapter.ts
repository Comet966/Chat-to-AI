import type { DesktopApi } from '../../../shared/desktop-api.contract.js'
import type { ConversationSnapshotDto, DesktopConversationEvent } from '../../../shared/conversation.contract.js'
import type {
  ChatUiMessage,
  ChatUiPort,
  ChatUiResult,
  ChatUiState,
  SendChatMessageInput
} from '../ports/chat-ui.port.js'

export class ElectronChatUiAdapter implements ChatUiPort {
  private state: ChatUiState = { status: 'idle', messages: [], error: null }
  private readonly listeners = new Set<(state: ChatUiState) => void>()
  private activeRequestId: string | null = null
  private pendingAssistantId: string | null = null
  private receivedDeltas: string[] = []
  private unsubscribeEvent: (() => void) | null = null
  private connectionGeneration = 0
  private stateGeneration = 0

  constructor(private readonly api: DesktopApi['conversation']) {}

  public connect(): void {
    if (this.unsubscribeEvent) return

    const connectionGeneration = ++this.connectionGeneration
    const stateGeneration = this.stateGeneration
    this.unsubscribeEvent = this.api.onEvent((event) => this.handleEvent(event))
    void this.api.getSnapshot().then((result) => {
      const isCurrentConnection =
        connectionGeneration === this.connectionGeneration && this.unsubscribeEvent !== null
      const stateIsUnchanged = stateGeneration === this.stateGeneration
      if (isCurrentConnection && stateIsUnchanged && result.ok) {
        this.syncFromSnapshot(result.value)
      }
    })
  }

  public dispose(): void {
    ++this.connectionGeneration
    this.unsubscribeEvent?.()
    this.unsubscribeEvent = null
  }

  public getState(): ChatUiState {
    return structuredClone(this.state)
  }

  public subscribe(listener: (state: ChatUiState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async sendMessage(input: SendChatMessageInput): Promise<ChatUiResult<void>> {
    const content = input.content.trim()
    if (!content) return { ok: false, error: { code: 'EMPTY_INPUT', message: 'Message cannot be empty' } }
    if (this.state.status === 'streaming') {
      return { ok: false, error: { code: 'TURN_IN_PROGRESS', message: 'A response is already streaming' } }
    }

    const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.pendingAssistantId = `pending-assistant-${localId}`
    this.activeRequestId = null
    this.receivedDeltas = []
    this.setState({
      status: 'streaming',
      error: null,
      messages: [
        ...this.state.messages,
        { id: `pending-user-${localId}`, role: 'user', content, timestamp: new Date().toISOString() },
        {
          id: this.pendingAssistantId,
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString()
        }
      ]
    })

    const result = await this.api.startTurn({
      prompt: content,
      expectedRevision: input.expectedRevision,
      currentTurnId: input.currentNodeId,
      contextSelection: {
        mode: input.contextSelection.mode,
        turnIds: [...input.contextSelection.nodeIds]
      }
    })
    if (!result.ok) {
      this.removePendingAssistant()
      this.activeRequestId = null
      this.receivedDeltas = []
      this.setState({ status: 'failed', error: result.error.message })
      return { ok: false, error: result.error }
    }
    this.activeRequestId = result.value.requestId
    return { ok: true, value: undefined }
  }

  public async cancel(): Promise<void> {
    const result = await this.api.cancelTurn()
    if (!result.ok) this.setState({ status: 'failed', error: result.error.message })
  }

  private handleEvent(event: DesktopConversationEvent): void {
    if (event.type === 'conversation.snapshot.changed') {
      this.syncFromSnapshot(event.snapshot)
      return
    }
    if (event.type === 'conversation.turn.started') {
      if (this.state.status === 'streaming') this.activeRequestId = event.requestId
      return
    }
    if (event.requestId !== this.activeRequestId) return

    if (event.type === 'conversation.turn.delta') {
      if (!this.pendingAssistantId || this.state.status !== 'streaming') return
      if (event.sequence < 0) return
      this.receivedDeltas[event.sequence] = event.delta
      const canonicalContent = this.receivedDeltas.join('')
      this.setState({
        messages: this.state.messages.map((message) =>
          message.id === this.pendingAssistantId
            ? { ...message, content: canonicalContent }
            : message
        )
      })
      return
    }
    if (event.type === 'conversation.turn.completed') {
      if (this.state.status !== 'streaming') return
      this.setState({ status: 'completed' })
      return
    }
    if (event.type === 'conversation.turn.cancelled') {
      if (this.state.status !== 'streaming') return
      this.removePendingAssistant()
      this.activeRequestId = null
      this.receivedDeltas = []
      this.setState({ status: 'cancelled' })
      return
    }
    if (event.type === 'conversation.turn.failed') {
      if (this.state.status !== 'streaming') return
      this.removePendingAssistant()
      this.activeRequestId = null
      this.receivedDeltas = []
      this.setState({ status: 'failed', error: event.error.message })
    }
  }

  private syncFromSnapshot(snapshot: ConversationSnapshotDto): void {
    const turnsById = new Map(snapshot.turns.map((turn) => [turn.id, turn]))
    const path = []
    let currentId = snapshot.currentTurnId
    const visited = new Set<string>()
    while (currentId) {
      if (visited.has(currentId)) break
      visited.add(currentId)
      const turn = turnsById.get(currentId)
      if (!turn) break
      path.push(turn)
      currentId = turn.parentId
    }
    path.reverse()
    const messages: ChatUiMessage[] = path.flatMap((turn) => [
      {
        id: `user-${turn.id}`,
        role: 'user' as const,
        content: turn.question,
        timestamp: turn.createdAt
      },
      {
        id: turn.id,
        role: 'assistant' as const,
        content: turn.answer,
        timestamp: turn.createdAt,
        declaredOutputFormat: turn.declaredOutputFormat,
        templateVersion: turn.templateVersion
      }
    ])
    this.pendingAssistantId = null
    this.activeRequestId = null
    this.setState({ status: 'idle', messages, error: null })
  }

  private removePendingAssistant(): void {
    if (!this.pendingAssistantId) return
    const pendingId = this.pendingAssistantId
    this.pendingAssistantId = null
    this.setState({ messages: this.state.messages.filter((message) => message.id !== pendingId) })
  }

  private setState(patch: Partial<ChatUiState>): void {
    ++this.stateGeneration
    this.state = { ...this.state, ...patch }
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }
}
