import type {
  ChatUiPort,
  ChatUiResult,
  ChatUiState,
  SendChatMessageInput
} from '../ports/chat-ui.port.js'
import type {
  AddChildNodeInput,
  ConversationTreeResult,
  ConversationTreeSnapshot,
  ConversationTreeUiPort,
  DeleteNodesInput
} from '../ports/conversation-tree-ui.port.js'

const unavailableError = { code: 'SERVICE_UNAVAILABLE', message: 'Desktop service is unavailable' }

export class UnavailableChatUiAdapter implements ChatUiPort {
  private state: ChatUiState = { status: 'failed', messages: [], error: unavailableError.message }
  public getState(): ChatUiState { return structuredClone(this.state) }
  public subscribe(_listener: (state: ChatUiState) => void): () => void { return () => {} }
  public async sendMessage(_input: SendChatMessageInput): Promise<ChatUiResult<void>> {
    return { ok: false, error: unavailableError }
  }
  public async cancel(): Promise<void> {}
}

export class UnavailableConversationTreeUiAdapter implements ConversationTreeUiPort {
  public async getSnapshot(): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: unavailableError.message } }
  }
  public subscribe(_listener: (snapshot: ConversationTreeSnapshot) => void): () => void { return () => {} }
  public async setCurrentNode(_nodeId: string): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.getSnapshot()
  }
  public async addChildNode(_input: AddChildNodeInput): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.getSnapshot()
  }
  public async deleteNodes(_input: DeleteNodesInput): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.getSnapshot()
  }
  public async reload(): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.getSnapshot()
  }
}
