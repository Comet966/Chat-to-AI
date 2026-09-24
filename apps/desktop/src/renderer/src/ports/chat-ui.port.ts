export type ChatUiStatus =
  | 'idle'
  | 'composing'
  | 'submitting-demo'
  | 'demo-completed'
  | 'cancelled'
  | 'failed'

export interface ChatUiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isDemo?: boolean
}

export interface ChatUiState {
  status: ChatUiStatus
  messages: ChatUiMessage[]
  error: string | null
}

export type ChatUiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

export interface ChatUiPort {
  getState(): ChatUiState
  sendMessage(content: string): Promise<ChatUiResult<void>>
  cancel(): Promise<void>
  subscribe(listener: (state: ChatUiState) => void): () => void
}
