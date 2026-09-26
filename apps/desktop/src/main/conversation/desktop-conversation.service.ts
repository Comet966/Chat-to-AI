import type { ModelExecutionDescriptor } from 'chat-conversation-runtime'
import {
  ConversationRuntimeService,
  type ConversationRuntimeError,
  type ConversationTurnEvent
} from 'chat-conversation-runtime'
import type { ConversationTreeService } from 'chat-conversation-tree'
import type {
  ConversationSnapshotDto,
  ConversationTurnAcceptedDto,
  DesktopConversationError,
  DesktopConversationEventSink,
  DesktopConversationResult,
  StartConversationTurnInput
} from '../../shared/conversation.contract.js'
import {
  projectConversationTurns,
  type ProjectedConversation
} from './conversation-turn.projector.js'

export interface ConversationModelProvider {
  getCurrentModel(): ModelExecutionDescriptor | null
}

export class MutableConversationModelProvider implements ConversationModelProvider {
  constructor(private model: ModelExecutionDescriptor | null = null) {}

  public getCurrentModel(): ModelExecutionDescriptor | null {
    return this.model
  }

  public setCurrentModel(model: ModelExecutionDescriptor | null): void {
    this.model = model
  }
}

export class DesktopConversationService {
  constructor(
    private readonly treeId: string,
    private readonly treeService: ConversationTreeService,
    private readonly runtime: ConversationRuntimeService,
    private readonly modelProvider: ConversationModelProvider
  ) {}

  public async getSnapshot(): Promise<DesktopConversationResult<ConversationSnapshotDto>> {
    const projection = await this.loadProjection()
    return projection.ok
      ? { ok: true, value: projection.value.snapshot }
      : projection
  }

  public async setCurrentTurn(
    turnId: string,
    expectedRevision: number
  ): Promise<DesktopConversationResult<ConversationSnapshotDto>> {
    const projection = await this.loadProjection()
    if (!projection.ok) return projection
    if (projection.value.snapshot.revision !== expectedRevision) {
      return this.failure('VERSION_CONFLICT', 'Conversation changed; reload before selecting a turn')
    }
    const pair = projection.value.turnNodePairs.get(turnId)
    if (!pair) {
      return this.failure('TURN_NOT_FOUND', 'The selected conversation turn does not exist')
    }

    const selected = await this.runtime.selectNode({
      treeId: this.treeId,
      nodeId: pair.assistantNodeId
    })
    if (!selected.ok) return { ok: false, error: this.mapRuntimeError(selected.error) }
    return this.getSnapshot()
  }

  public async startTurn(
    input: StartConversationTurnInput,
    sink: DesktopConversationEventSink
  ): Promise<DesktopConversationResult<ConversationTurnAcceptedDto>> {
    const projection = await this.loadProjection()
    if (!projection.ok) return projection
    const { snapshot, turnNodePairs } = projection.value

    if (
      snapshot.revision !== input.expectedRevision ||
      snapshot.currentTurnId !== input.currentTurnId
    ) {
      return this.failure('VERSION_CONFLICT', 'Conversation changed; reload before sending')
    }

    const model = this.modelProvider.getCurrentModel()
    if (!model) {
      return this.failure('NOT_CONFIGURED', 'Configure an AI provider before sending a message')
    }

    const basePair = input.currentTurnId
      ? turnNodePairs.get(input.currentTurnId)
      : undefined
    if (input.currentTurnId && !basePair) {
      return this.failure('TURN_NOT_FOUND', 'The current conversation turn does not exist')
    }

    let contextSelection:
      | { mode: 'root-path' }
      | { mode: 'explicit-nodes'; nodeIds: readonly string[] }
    if (input.contextSelection.mode === 'manual') {
      if (snapshot.turns.length > 0 && input.contextSelection.turnIds.length === 0) {
        return this.failure(
          'INVALID_CONTEXT_SELECTION',
          'Select at least one completed turn for manual context'
        )
      }
      if (new Set(input.contextSelection.turnIds).size !== input.contextSelection.turnIds.length) {
        return this.failure('INVALID_CONTEXT_SELECTION', 'Manual context contains duplicate turns')
      }
      const selectedTurns = input.contextSelection.turnIds.map((turnId) => {
        const turn = snapshot.turns.find((candidate) => candidate.id === turnId)
        const pair = turnNodePairs.get(turnId)
        return turn && pair ? { turn, pair } : null
      })
      if (selectedTurns.some((turn) => turn === null)) {
        return this.failure('INVALID_CONTEXT_SELECTION', 'Manual context contains an unknown turn')
      }
      const ordered = selectedTurns
        .filter((turn): turn is NonNullable<typeof turn> => turn !== null)
        .sort((left, right) => left.turn.sequence - right.turn.sequence)
      contextSelection = {
        mode: 'explicit-nodes',
        nodeIds: ordered.flatMap(({ pair }) => [pair.userNodeId, pair.assistantNodeId])
      }
    } else {
      contextSelection = { mode: 'root-path' }
    }

    let acceptanceSettled = false
    let settleAcceptance:
      (result: DesktopConversationResult<ConversationTurnAcceptedDto>) => void = () => {}
    const accepted = new Promise<DesktopConversationResult<ConversationTurnAcceptedDto>>(
      (resolve) => {
        settleAcceptance = resolve
      }
    )

    const execution = this.runtime.sendMessage(
      {
        treeId: this.treeId,
        prompt: input.prompt,
        ...(basePair ? { selectedNodeId: basePair.assistantNodeId } : {}),
        contextSelection,
        model
      },
      {
        emit: (event) => {
          if (event.type === 'conversation.turn.started' && !acceptanceSettled) {
            acceptanceSettled = true
            settleAcceptance({ ok: true, value: { requestId: event.requestId } })
          }
          this.forwardRuntimeEvent(event, sink)
        }
      }
    )

    void execution.then((result) => {
      if (!acceptanceSettled) {
        acceptanceSettled = true
        settleAcceptance(
          result.ok
            ? { ok: true, value: { requestId: result.value.requestId } }
            : { ok: false, error: this.mapRuntimeError(result.error) }
        )
      }
    })

    return accepted
  }

  public async cancelTurn(): Promise<DesktopConversationResult<void>> {
    const result = await this.runtime.cancelTurn({ treeId: this.treeId })
    return result.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: this.mapRuntimeError(result.error) }
  }

  private async loadProjection(): Promise<DesktopConversationResult<ProjectedConversation>> {
    const tree = await this.treeService.getTree(this.treeId)
    if (!tree.ok) {
      if (tree.error.code === 'TREE_NOT_FOUND') {
        return {
          ok: true,
          value: {
            snapshot: {
              treeId: this.treeId,
              revision: 0,
              rootTurnId: null,
              currentTurnId: null,
              turns: []
            },
            turnNodePairs: new Map()
          }
        }
      }
      return this.failure('INTERNAL_ERROR', 'Unable to load the conversation')
    }

    const current = await this.runtime.getCurrentNode(this.treeId)
    const currentNodeId = current.ok ? current.value.id : null
    return projectConversationTurns(tree.value, currentNodeId)
  }

  private forwardRuntimeEvent(
    event: ConversationTurnEvent,
    sink: DesktopConversationEventSink
  ): void {
    if (event.type === 'conversation.turn.started') {
      sink.emit({
        type: event.type,
        schemaVersion: 1,
        treeId: event.treeId,
        requestId: event.requestId
      })
      return
    }
    if (event.type === 'conversation.turn.delta') {
      sink.emit({
        type: event.type,
        schemaVersion: 1,
        treeId: event.treeId,
        requestId: event.requestId,
        sequence: event.sequence,
        delta: event.delta
      })
      return
    }
    if (event.type === 'conversation.turn.completed') {
      sink.emit({
        type: event.type,
        schemaVersion: 1,
        treeId: event.treeId,
        requestId: event.requestId,
        finishReason: event.finishReason
      })
      void this.getSnapshot().then((snapshot) => {
        if (snapshot.ok) {
          sink.emit({
            type: 'conversation.snapshot.changed',
            schemaVersion: 1,
            treeId: event.treeId,
            snapshot: snapshot.value
          })
        }
      })
      return
    }
    if (event.type === 'conversation.turn.cancelled') {
      sink.emit({
        type: event.type,
        schemaVersion: 1,
        treeId: event.treeId,
        requestId: event.requestId
      })
      return
    }
    sink.emit({
      type: event.type,
      schemaVersion: 1,
      treeId: event.treeId,
      requestId: event.requestId,
      error: this.mapRuntimeError(event.error)
    })
  }

  private mapRuntimeError(error: ConversationRuntimeError): DesktopConversationError {
    switch (error.code) {
      case 'TREE_NOT_FOUND':
        return { code: 'TREE_NOT_FOUND', message: error.message }
      case 'NODE_NOT_FOUND':
        return { code: 'TURN_NOT_FOUND', message: error.message }
      case 'TURN_IN_PROGRESS':
        return { code: 'TURN_IN_PROGRESS', message: error.message }
      case 'TREE_VERSION_CONFLICT':
        return { code: 'VERSION_CONFLICT', message: error.message }
      case 'INVALID_CONTEXT_SELECTION':
      case 'CONTEXT_LIMIT_EXCEEDED':
        return { code: 'INVALID_CONTEXT_SELECTION', message: error.message }
      case 'INVALID_PROMPT':
        return { code: 'VALIDATION_FAILED', message: error.message }
      case 'MODEL_REQUEST_CANCELLED':
        return { code: 'CANCELLED', message: error.message }
      case 'MODEL_REQUEST_FAILED':
      case 'MODEL_REQUEST_REJECTED':
      case 'EMPTY_MODEL_RESPONSE':
        return { code: 'MODEL_REQUEST_FAILED', message: error.message }
      default:
        return { code: 'INTERNAL_ERROR', message: 'Conversation request failed' }
    }
  }

  private failure<T>(
    code: DesktopConversationError['code'],
    message: string
  ): DesktopConversationResult<T> {
    return { ok: false, error: { code, message } }
  }
}
