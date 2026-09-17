import type { ConversationTreeId } from 'chat-conversation-tree'
import type { StreamingChatExecutor } from './ports/streaming-chat-executor.port.js'

export interface ActiveTurn {
  readonly treeId: ConversationTreeId
  readonly requestId: string
  readonly executor: StreamingChatExecutor
}

export class ActiveTurnRegistry {
  private readonly activeTurns = new Map<ConversationTreeId, ActiveTurn>()

  public hasActiveTurn(treeId: ConversationTreeId): boolean {
    return this.activeTurns.has(treeId)
  }

  public register(treeId: ConversationTreeId, requestId: string, executor: StreamingChatExecutor): boolean {
    if (this.activeTurns.has(treeId)) {
      return false
    }
    this.activeTurns.set(treeId, { treeId, requestId, executor })
    return true
  }

  public getActiveTurn(treeId: ConversationTreeId): ActiveTurn | undefined {
    return this.activeTurns.get(treeId)
  }

  public release(treeId: ConversationTreeId, requestId?: string): void {
    const activeTurn = this.activeTurns.get(treeId)
    if (requestId && activeTurn?.requestId !== requestId) {
      return
    }
    this.activeTurns.delete(treeId)
  }
}
