import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_IPC_CHANNELS } from '../../shared/desktop-api.contract.js'
import { DesktopCancelImageInputSchema, DesktopGenerateImageInputSchema, DesktopSaveImageInputSchema } from '../../shared/image-generation.schemas.js'
import type { SenderPolicy } from '../security/sender-policy.js'
import type { DesktopImageGenerationService } from './desktop-image-generation.service.js'

export class ImageGenerationTransport {
  constructor(
    private readonly service: DesktopImageGenerationService,
    private readonly senderPolicy: SenderPolicy,
    private readonly ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'> = ipcMain
  ) {}

  public register(): () => void {
    this.ipc.handle(DESKTOP_IPC_CHANNELS.IMAGE_GENERATE, (event, payload) => this.handleGenerate(event, payload))
    this.ipc.handle(DESKTOP_IPC_CHANNELS.IMAGE_CANCEL, (event, payload) => this.handleCancel(event, payload))
    this.ipc.handle(DESKTOP_IPC_CHANNELS.IMAGE_SAVE, (event, payload) => this.handleSave(event, payload))
    return () => {
      for (const channel of [DESKTOP_IPC_CHANNELS.IMAGE_GENERATE, DESKTOP_IPC_CHANNELS.IMAGE_CANCEL, DESKTOP_IPC_CHANNELS.IMAGE_SAVE]) this.ipc.removeHandler(channel)
      this.service.dispose()
    }
  }

  public async handleGenerate(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = DesktopGenerateImageInputSchema.safeParse(payload)
    if (!parsed.success) return this.invalid()
    try { return await this.service.generate(parsed.data) }
    catch { return { ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: '图片服务发生内部错误' } } }
  }

  public handleCancel(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = DesktopCancelImageInputSchema.safeParse(payload)
    return parsed.success ? this.service.cancel(parsed.data.requestId) : this.invalid()
  }

  public async handleSave(event: IpcMainInvokeEvent, payload: unknown) {
    if (!this.senderPolicy.isAllowedSender(event)) return this.unauthorized()
    const parsed = DesktopSaveImageInputSchema.safeParse(payload)
    return parsed.success ? this.service.save(parsed.data.requestId, parsed.data.imageIndex) : this.invalid()
  }

  private unauthorized() { return { ok: false as const, error: { code: 'UNAUTHORIZED_SENDER' as const, message: 'Unauthorized IPC sender' } } }
  private invalid() { return { ok: false as const, error: { code: 'VALIDATION_FAILED' as const, message: 'Invalid image generation request' } } }
}
