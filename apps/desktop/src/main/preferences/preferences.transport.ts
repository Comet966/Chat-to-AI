import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_IPC_CHANNELS } from '../../shared/desktop-api.contract.js'
import type { DesktopPreferencesResult } from '../../shared/preferences.contract.js'
import {
  ConversationEmptyInputSchema,
  SaveGenerationPreferencesInputSchema,
  SetActiveFormatInputSchema
} from '../../shared/desktop-api.schemas.js'
import type { SenderPolicy } from '../security/sender-policy.js'
import type { GenerationPreferencesService } from './generation-preferences.service.js'

type PreferencesIpc = Pick<typeof ipcMain, 'handle' | 'removeHandler'>

export class PreferencesTransport {
  private readonly ipc: PreferencesIpc

  constructor(
    private readonly service: GenerationPreferencesService,
    private readonly senderPolicy: SenderPolicy,
    ipc?: PreferencesIpc
  ) {
    this.ipc = ipc ?? ipcMain
  }

  public register(): () => void {
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PREFERENCES_GET, (event, payload) =>
      this.handleGetPreferences(event, payload)
    )
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PREFERENCES_SAVE, (event, payload) =>
      this.handleSavePreferences(event, payload)
    )
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PREFERENCES_SET_ACTIVE_FORMAT, (event, payload) =>
      this.handleSetActiveFormat(event, payload)
    )
    return () => {
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PREFERENCES_GET)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PREFERENCES_SAVE)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PREFERENCES_SET_ACTIVE_FORMAT)
    }
  }

  public async handleGetPreferences(event: IpcMainInvokeEvent, payload: unknown) {
    const error = this.validateEmpty(event, payload)
    return error ?? this.service.getPreferences()
  }

  public async handleSavePreferences(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = SaveGenerationPreferencesInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalid(parsed)
    return this.service.savePreferences(parsed.data)
  }

  public async handleSetActiveFormat(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = SetActiveFormatInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalid(parsed)
    return this.service.setActiveFormat(parsed.data.format)
  }

  private validateEmpty(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): DesktopPreferencesResult<never> | null {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    if (!ConversationEmptyInputSchema.safeParse(payload).success) return this.invalid()
    return null
  }

  private unauthorized(): DesktopPreferencesResult<never> {
    return {
      ok: false,
      error: { code: 'UNAUTHORIZED_SENDER', message: 'Unauthorized IPC sender' }
    }
  }

  private invalid(issue?: {
    error?: { errors: Array<{ path: Array<string | number>; message: string }> }
  }): DesktopPreferencesResult<never> {
    const firstIssue = issue?.error?.errors?.[0]
    const field = firstIssue?.path[0]?.toString()
    const detail = firstIssue ? `: ${firstIssue.path.join('.')}: ${firstIssue.message}` : ''
    return {
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: `Invalid preferences request${detail}`,
        ...(field ? { field } : {})
      }
    }
  }
}

export function registerPreferencesTransport(
  service: GenerationPreferencesService,
  senderPolicy: SenderPolicy,
  ipc?: PreferencesIpc
): () => void {
  return new PreferencesTransport(service, senderPolicy, ipc).register()
}
