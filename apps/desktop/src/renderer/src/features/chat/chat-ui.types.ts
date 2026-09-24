export type {
  ChatUiMessage,
  ChatUiPort,
  ChatUiResult,
  ChatUiState,
  ChatUiStatus
} from '../../ports/chat-ui.port.js'

export interface ChatHeaderInfo {
  provider: string
  modelId: string
}
