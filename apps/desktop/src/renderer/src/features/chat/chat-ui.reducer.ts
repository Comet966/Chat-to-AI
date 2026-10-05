import type { ChatUiMessage, ChatUiState, ChatUiStatus } from './chat-ui.types.js'

export type ChatUiAction =
  | { type: 'setStatus'; status: ChatUiStatus }
  | { type: 'addMessage'; message: ChatUiMessage }
  | { type: 'setError'; error: string | null }
  | { type: 'syncState'; state: ChatUiState }

export function chatUiReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
  switch (action.type) {
    case 'setStatus':
      return { ...state, status: action.status }
    case 'addMessage':
      return { ...state, messages: [...state.messages, action.message] }
    case 'setError':
      return { ...state, error: action.error }
    case 'syncState':
      return { ...action.state }
    default:
      return state
  }
}
