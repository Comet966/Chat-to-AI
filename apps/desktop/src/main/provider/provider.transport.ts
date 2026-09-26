import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_IPC_CHANNELS } from '../../shared/desktop-api.contract.js'
import type { DesktopProviderResult } from '../../shared/provider.contract.js'
import {
  ConversationEmptyInputSchema,
  ProviderSettingsInputSchema
} from '../../shared/desktop-api.schemas.js'
import type { SenderPolicy } from '../security/sender-policy.js'
import type { ProviderRuntimeService } from './provider-runtime.service.js'

type ProviderIpc = Pick<typeof ipcMain, 'handle' | 'removeHandler'>

export class ProviderTransport {
  private readonly ipc: ProviderIpc

  constructor(
    private readonly service: ProviderRuntimeService,
    private readonly senderPolicy: SenderPolicy,
    ipc?: ProviderIpc
  ) {
    this.ipc = ipc ?? ipcMain
  }

  public register(): () => void {
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PROVIDER_GET_SETTINGS, (event, payload) =>
      this.handleGetSettings(event, payload))
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PROVIDER_SAVE_SETTINGS, (event, payload) =>
      this.handleSaveSettings(event, payload))
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PROVIDER_CLEAR_KEY, (event, payload) =>
      this.handleClearKey(event, payload))
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PROVIDER_TEST_CONNECTION, (event, payload) =>
      this.handleTestConnection(event, payload))
    this.ipc.handle(DESKTOP_IPC_CHANNELS.PROVIDER_LIST_MODELS, (event, payload) =>
      this.handleListModels(event, payload))
    return () => {
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PROVIDER_GET_SETTINGS)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PROVIDER_SAVE_SETTINGS)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PROVIDER_CLEAR_KEY)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PROVIDER_TEST_CONNECTION)
      this.ipc.removeHandler(DESKTOP_IPC_CHANNELS.PROVIDER_LIST_MODELS)
    }
  }

  public async handleGetSettings(event: IpcMainInvokeEvent, payload: unknown) {
    const error = this.validateEmpty(event, payload)
    return error ?? this.service.getSettings()
  }

  public async handleSaveSettings(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = ProviderSettingsInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalid()
    return this.service.saveSettings(parsed.data)
  }

  public async handleClearKey(event: IpcMainInvokeEvent, payload: unknown) {
    const error = this.validateEmpty(event, payload)
    return error ?? this.service.clearKey()
  }

  public async handleTestConnection(event: IpcMainInvokeEvent, payload: unknown) {
    const error = this.validateEmpty(event, payload)
    return error ?? this.service.testConnection()
  }

  public async handleListModels(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = ProviderSettingsInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalid()
    return this.service.listModels(parsed.data)
  }

  private validateEmpty(event: IpcMainInvokeEvent, payload: unknown): DesktopProviderResult<never> | null {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    if (!ConversationEmptyInputSchema.safeParse(payload).success) return this.invalid()
    return null
  }

  private unauthorized(): DesktopProviderResult<never> {
    return {
      ok: false,
      error: { code: 'UNAUTHORIZED_SENDER', message: 'Unauthorized IPC sender' }
    }
  }

  private invalid(): DesktopProviderResult<never> {
    return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid provider request' } }
  }
}

export function registerProviderTransport(
  service: ProviderRuntimeService,
  senderPolicy: SenderPolicy
): () => void {
  return new ProviderTransport(service, senderPolicy).register()
}
