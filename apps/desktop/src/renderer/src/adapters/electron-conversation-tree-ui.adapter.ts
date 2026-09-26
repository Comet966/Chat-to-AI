import type { DesktopApi } from '../../../shared/desktop-api.contract.js'
import type { ConversationSnapshotDto } from '../../../shared/conversation.contract.js'
import type {
  AddChildNodeInput,
  ConversationTreeResult,
  ConversationTreeSnapshot,
  ConversationTreeUiPort,
  DeleteNodesInput
} from '../ports/conversation-tree-ui.port.js'

export class ElectronConversationTreeUiAdapter implements ConversationTreeUiPort {
  private snapshot: ConversationTreeSnapshot | null = null
  private readonly listeners = new Set<(snapshot: ConversationTreeSnapshot) => void>()

  constructor(private readonly api: DesktopApi['conversation']) {
    this.api.onEvent((event) => {
      if (event.type === 'conversation.snapshot.changed') {
        this.updateSnapshot(this.mapSnapshot(event.snapshot))
      }
    })
  }

  public async getSnapshot(): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    if (this.snapshot) return { ok: true, value: this.cloneSnapshot(this.snapshot) }
    return this.reload()
  }

  public subscribe(listener: (snapshot: ConversationTreeSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async setCurrentNode(
    nodeId: string
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    let current = this.snapshot
    if (!current) {
      const reloaded = await this.reload()
      if (!reloaded.ok) return reloaded
      current = reloaded.value
    }
    const result = await this.api.setCurrentTurn({
      turnId: nodeId,
      expectedRevision: current.revision
    })
    if (!result.ok) return this.mapFailure(result.error.code, result.error.message)
    const snapshot = this.mapSnapshot(result.value)
    this.updateSnapshot(snapshot)
    return { ok: true, value: this.cloneSnapshot(snapshot) }
  }

  public async addChildNode(
    _input: AddChildNodeInput
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.notImplemented('New turns are created by sending a real AI message')
  }

  public async deleteNodes(
    _input: DeleteNodesInput
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.notImplemented('Deleting real conversation turns is not implemented yet')
  }

  public async reload(): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const result = await this.api.getSnapshot()
    if (!result.ok) return this.mapFailure(result.error.code, result.error.message)
    const snapshot = this.mapSnapshot(result.value)
    this.updateSnapshot(snapshot)
    return { ok: true, value: this.cloneSnapshot(snapshot) }
  }

  private mapSnapshot(snapshot: ConversationSnapshotDto): ConversationTreeSnapshot {
    return {
      treeId: snapshot.treeId,
      revision: snapshot.revision,
      rootId: snapshot.rootTurnId ?? '',
      currentNodeId: snapshot.currentTurnId ?? '',
      nodes: snapshot.turns.map((turn) => ({
        id: turn.id,
        parentId: turn.parentId,
        question: turn.question,
        answer: turn.answer,
        sequence: turn.sequence,
        createdAt: turn.createdAt,
        ...(turn.providerInfo ? { providerInfo: { ...turn.providerInfo } } : {})
      }))
    }
  }

  private updateSnapshot(snapshot: ConversationTreeSnapshot): void {
    this.snapshot = this.cloneSnapshot(snapshot)
    for (const listener of this.listeners) listener(this.cloneSnapshot(snapshot))
  }

  private cloneSnapshot(snapshot: ConversationTreeSnapshot): ConversationTreeSnapshot {
    return structuredClone(snapshot)
  }

  private mapFailure(code: string, message: string): ConversationTreeResult<never> {
    if (code === 'TURN_NOT_FOUND') {
      return { ok: false, error: { code: 'NODE_NOT_FOUND', message } }
    }
    if (code === 'VALIDATION_FAILED') {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message } }
  }

  private internalFailure(message: string): ConversationTreeResult<never> {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message } }
  }

  private notImplemented(message: string): ConversationTreeResult<never> {
    return { ok: false, error: { code: 'NOT_IMPLEMENTED', message } }
  }
}
