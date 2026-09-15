import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  CancelChatCommandSchema,
  IPC_CHANNELS,
  StartChatCommandSchema,
  type CancelChatResult,
  type ChatEvent,
  type StartChatResult
} from 'chat-contracts'
import type { ChatEventSink, ChatKernel } from 'chat-core'

export interface ElectronTransportOptions {
  kernel: ChatKernel
  allowedOrigins?: string[]
}

export class ElectronTransport {
  private readonly kernel: ChatKernel
  private readonly allowedOrigins: string[]
  private activeSinkWebContents: WebContents | null = null

  constructor(options: ElectronTransportOptions) {
    this.kernel = options.kernel
    this.allowedOrigins = options.allowedOrigins ?? ['http://localhost:', 'file://']
  }

  public register(): () => void {
    const handleStart = (event: IpcMainInvokeEvent, rawPayload: unknown): Promise<StartChatResult> => {
      return this.handleStartChat(event, rawPayload)
    }

    const handleCancel = (event: IpcMainInvokeEvent, rawPayload: unknown): Promise<CancelChatResult> => {
      return this.handleCancelChat(event, rawPayload)
    }

    ipcMain.handle(IPC_CHANNELS.CHAT_STREAM_START, handleStart)
    ipcMain.handle(IPC_CHANNELS.CHAT_STREAM_CANCEL, handleCancel)

    return () => {
      ipcMain.removeHandler(IPC_CHANNELS.CHAT_STREAM_START)
      ipcMain.removeHandler(IPC_CHANNELS.CHAT_STREAM_CANCEL)
      this.activeSinkWebContents = null
    }
  }

  public async handleStartChat(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<StartChatResult> {
    if (!this.isAllowedSender(event)) {
      return {
        requestId: typeof rawPayload === 'object' && rawPayload && 'requestId' in rawPayload ? String((rawPayload as { requestId: unknown }).requestId) : 'unknown',
        accepted: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Unauthorized IPC sender origin',
          retryable: false
        }
      }
    }

    const parseResult = StartChatCommandSchema.safeParse(rawPayload)
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      return {
        requestId: typeof rawPayload === 'object' && rawPayload && 'requestId' in rawPayload ? String((rawPayload as { requestId: unknown }).requestId) : 'unknown',
        accepted: false,
        error: {
          code: 'INVALID_REQUEST',
          message: `Invalid command payload: ${firstError?.message ?? 'Schema validation failed'}`,
          retryable: false
        }
      }
    }

    const command = parseResult.data
    const webContents = event.sender
    this.activeSinkWebContents = webContents

    const sink: ChatEventSink = {
      emit: (chatEvent: ChatEvent) => {
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_CHANNELS.CHAT_STREAM_EVENT, chatEvent)
        }
      }
    }

    return this.kernel.start(command, sink)
  }

  public async handleCancelChat(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<CancelChatResult> {
    if (!this.isAllowedSender(event)) {
      return {
        requestId: typeof rawPayload === 'object' && rawPayload && 'requestId' in rawPayload ? String((rawPayload as { requestId: unknown }).requestId) : 'unknown',
        cancelled: false
      }
    }

    const parseResult = CancelChatCommandSchema.safeParse(rawPayload)
    if (!parseResult.success) {
      return {
        requestId: typeof rawPayload === 'object' && rawPayload && 'requestId' in rawPayload ? String((rawPayload as { requestId: unknown }).requestId) : 'unknown',
        cancelled: false
      }
    }

    return this.kernel.cancel(parseResult.data)
  }

  private isAllowedSender(event: IpcMainInvokeEvent): boolean {
    const senderUrl = event.senderFrame?.url
    if (!senderUrl) {
      return false
    }

    return this.allowedOrigins.some((allowed) => senderUrl.startsWith(allowed))
  }
}

export function registerElectronChatTransport(options: ElectronTransportOptions): () => void {
  const transport = new ElectronTransport(options)
  return transport.register()
}
