import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  DESKTOP_IPC_CHANNELS,
  type AppInfo,
  type DesktopResult
} from '../shared/desktop-api.contract.js'
import { AppGetInfoInputSchema } from '../shared/desktop-api.schemas.js'
import type { SenderPolicy } from './security/sender-policy.js'

export interface DesktopShellTransportOptions {
  senderPolicy: SenderPolicy
  ipc?: Pick<typeof ipcMain, 'handle' | 'removeHandler'>
}

export class DesktopShellTransport {
  private readonly senderPolicy: SenderPolicy
  private readonly ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>

  constructor(options: DesktopShellTransportOptions) {
    this.senderPolicy = options.senderPolicy
    this.ipc = options.ipc ?? ipcMain
  }

  public register(): () => void {
    const handleGetInfo = (
      event: IpcMainInvokeEvent,
      rawPayload: unknown
    ): Promise<DesktopResult<AppInfo>> => {
      return this.handleGetInfo(event, rawPayload)
    }

    this.ipc.handle(DESKTOP_IPC_CHANNELS.APP_GET_INFO, handleGetInfo)

    return () => {
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.APP_GET_INFO)
    }
  }

  public async handleGetInfo(
    event: IpcMainInvokeEvent,
    rawPayload: unknown
  ): Promise<DesktopResult<AppInfo>> {
    if (!this.senderPolicy.isAllowedSender(event)) {
      return {
        ok: false,
        error: {
          code: 'UNAUTHORIZED_SENDER',
          message: 'Unauthorized IPC sender or non-top-level frame'
        }
      }
    }

    const parseRes = AppGetInfoInputSchema.safeParse(rawPayload)
    if (!parseRes.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid get-info request payload'
        }
      }
    }

    return {
      ok: true,
      value: {
        name: (typeof app !== 'undefined' && app?.getName?.()) || 'Chat to AI',
        version: (typeof app !== 'undefined' && app?.getVersion?.()) || '0.1.0',
        isPackaged: Boolean(typeof app !== 'undefined' && app?.isPackaged),
        platform: process.platform
      }
    }
  }
}

export function registerDesktopShellTransport(
  options: DesktopShellTransportOptions
): () => void {
  const transport = new DesktopShellTransport(options)
  return transport.register()
}
