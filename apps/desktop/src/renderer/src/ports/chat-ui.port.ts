export type ChatUiStatus =
  | 'idle'
  | 'composing'
  | 'submitting-demo'
  | 'demo-completed'
  | 'streaming'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface ChatUiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isDemo?: boolean
  declaredOutputFormat?: 'markdown' | 'html'
  templateVersion?: number
}

export interface ChatUiState {
  status: ChatUiStatus
  messages: ChatUiMessage[]
  error: string | null
}

export type ChatUiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

export interface SendChatMessageInput {
  content: string
  expectedRevision: number
  currentNodeId: string | null
  contextSelection: {
    mode: 'root-path' | 'manual'
    nodeIds: readonly string[]
  }
}

export interface ChatUiPort {
  /** Starts external event subscriptions. Safe to call more than once or after dispose. */
  connect?: () => void
  getState(): ChatUiState
  sendMessage(input: SendChatMessageInput): Promise<ChatUiResult<void>>
  cancel(): Promise<void>
  subscribe(listener: (state: ChatUiState) => void): () => void
  /** Stops external subscriptions without invalidating local UI subscribers. */
  dispose?: () => void
}
