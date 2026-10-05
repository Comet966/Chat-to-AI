import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_IPC_CHANNELS } from '../../shared/desktop-api.contract.js'
import type {
  ConversationSnapshotDto,
  ConversationTurnAcceptedDto,
  DesktopConversationResult
} from '../../shared/conversation.contract.js'
import {
  ConversationEmptyInputSchema,
  DesktopConversationEventSchema,
  SetCurrentConversationTurnInputSchema,
  StartConversationTurnInputSchema
} from '../../shared/desktop-api.schemas.js'
import type { SenderPolicy } from '../security/sender-policy.js'
import type { DesktopConversationService } from './desktop-conversation.service.js'

type ConversationIpc = Pick<typeof ipcMain, 'handle' | 'removeHandler'>

export interface ConversationTransportOptions {
  service: DesktopConversationService
  senderPolicy: SenderPolicy
  ipc?: ConversationIpc
}

export class ConversationTransport {
  private readonly service: DesktopConversationService
  private readonly senderPolicy: SenderPolicy
  private readonly ipc: ConversationIpc

  constructor(options: ConversationTransportOptions) {
    this.service = options.service
    this.senderPolicy = options.senderPolicy
    this.ipc = options.ipc ?? ipcMain
  }

  public register(): () => void {
    this.ipc.handle(
      DESKTOP_IPC_CHANNELS.CONVERSATION_GET_SNAPSHOT,
      (event, payload) => this.handleGetSnapshot(event, payload)
    )
    this.ipc.handle(
      DESKTOP_IPC_CHANNELS.CONVERSATION_SET_CURRENT,
      (event, payload) => this.handleSetCurrent(event, payload)
    )
    this.ipc.handle(
      DESKTOP_IPC_CHANNELS.CONVERSATION_START_TURN,
      (event, payload) => this.handleStartTurn(event, payload)
    )
    this.ipc.handle(
      DESKTOP_IPC_CHANNELS.CONVERSATION_CANCEL_TURN,
      (event, payload) => this.handleCancelTurn(event, payload)
    )

    return () => {
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.CONVERSATION_GET_SNAPSHOT)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.CONVERSATION_SET_CURRENT)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.CONVERSATION_START_TURN)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.CONVERSATION_CANCEL_TURN)
      void this.service.cancelTurn()
    }
  }

  public async handleGetSnapshot(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<DesktopConversationResult<ConversationSnapshotDto>> {
    const boundaryError = this.validateBoundary(event, payload, ConversationEmptyInputSchema)
    if (boundaryError) return boundaryError
    return this.service.getSnapshot()
  }

  public async handleSetCurrent(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<DesktopConversationResult<ConversationSnapshotDto>> {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = SetCurrentConversationTurnInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalidPayload('Invalid set-current request')
    const result = await this.service.setCurrentTurn(parsed.data.turnId, parsed.data.expectedRevision)
    if (result.ok && !event.sender.isDestroyed()) {
      event.sender.send(DESKTOP_IPC_CHANNELS.CONVERSATION_EVENT, {
        type: 'conversation.snapshot.changed',
        schemaVersion: 1,
        treeId: result.value.treeId,
        snapshot: result.value
      })
    }
    return result
  }

  public async handleStartTurn(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<DesktopConversationResult<ConversationTurnAcceptedDto>> {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = StartConversationTurnInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalidPayload('Invalid conversation turn request')

    const sender = event.sender
    return this.service.startTurn(parsed.data, {
      emit: (conversationEvent) => {
        const validated = DesktopConversationEventSchema.safeParse(conversationEvent)
        if (validated.success && !sender.isDestroyed()) {
          sender.send(DESKTOP_IPC_CHANNELS.CONVERSATION_EVENT, validated.data)
        }
      }
    })
  }

  public async handleCancelTurn(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<DesktopConversationResult<void>> {
    const boundaryError = this.validateBoundary(event, payload, ConversationEmptyInputSchema)
    if (boundaryError) return boundaryError
    return this.service.cancelTurn()
  }

  private validateBoundary(
    event: IpcMainInvokeEvent,
    payload: unknown,
    schema: { safeParse(value: unknown): { success: boolean } }
  ): { ok: false; error: { code: 'UNAUTHORIZED_SENDER' | 'VALIDATION_FAILED'; message: string } } | null {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    if (!schema.safeParse(payload).success) return this.invalidPayload('Invalid request payload')
    return null
  }

  private unauthorized(): {
    ok: false
    error: { code: 'UNAUTHORIZED_SENDER'; message: string }
  } {
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED_SENDER',
        message: 'Unauthorized IPC sender or non-top-level frame'
      }
    }
  }

  private invalidPayload(message: string): {
    ok: false
    error: { code: 'VALIDATION_FAILED'; message: string }
  } {
    return { ok: false, error: { code: 'VALIDATION_FAILED', message } }
  }
}

export function registerConversationTransport(options: ConversationTransportOptions): () => void {
  return new ConversationTransport(options).register()
}
