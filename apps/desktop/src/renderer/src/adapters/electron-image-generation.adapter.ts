import type { DesktopImageGenerationApi, DesktopImageGenerationDto, DesktopImageResult } from '../../../shared/image-generation.contract.js'
import type { ImageGenerationUiPort } from '../ports/image-generation-ui.port.js'

const unavailable = <T>(): DesktopImageResult<T> => ({
  ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '桌面生图服务不可用，请通过 Electron 启动应用' }
})

export class ElectronImageGenerationAdapter implements ImageGenerationUiPort {
  constructor(private readonly api: DesktopImageGenerationApi) {}
  public async generate(input: Parameters<ImageGenerationUiPort['generate']>[0]) {
    try { return await this.api.generate(input) } catch { return unavailable<DesktopImageGenerationDto>() }
  }
  public async cancel(input: { requestId: string }) {
    try { return await this.api.cancel(input) } catch { return unavailable<{ cancelled: boolean }>() }
  }
  public async save(input: { requestId: string; imageIndex: number }) {
    try { return await this.api.save(input) } catch { return unavailable<{ saved: boolean }>() }
  }
}

export class UnavailableImageGenerationAdapter implements ImageGenerationUiPort {
  public async generate(_input: Parameters<ImageGenerationUiPort['generate']>[0]) { return unavailable<DesktopImageGenerationDto>() }
  public async cancel(_input: { requestId: string }) { return unavailable<{ cancelled: boolean }>() }
  public async save(_input: { requestId: string; imageIndex: number }) { return unavailable<{ saved: boolean }>() }
}
