import { ImageGenerationKernel, type ImageGenerationModelPort } from 'chat-core'
import { createImageGenerationAdapter, type ProviderConfig } from 'chat-model-adapters'
import type { GeneratedImage } from 'chat-contracts'
import type { DesktopGenerateImageInput, DesktopImageGenerationDto, DesktopImageResult } from '../../shared/image-generation.contract.js'
import { DesktopGenerateImageInputSchema } from '../../shared/image-generation.schemas.js'

export interface DesktopImageGenerationServiceOptions {
  getProviderConfig(): ProviderConfig | null
  createAdapter?: typeof createImageGenerationAdapter
  saveImage?: (image: Extract<GeneratedImage, { type: 'base64' }>, imageIndex: number) => Promise<boolean>
  timeoutMs?: number
}

export class DesktopImageGenerationService {
  private active: { requestId: string; kernel: ImageGenerationKernel } | null = null
  // Only keep the latest successful result. No unbounded image history or tree mutations.
  private latestResult: DesktopImageGenerationDto | null = null
  private disposed = false

  constructor(private readonly options: DesktopImageGenerationServiceOptions) {}

  public hasActiveRequest(): boolean { return this.active !== null }

  public async generate(input: DesktopGenerateImageInput): Promise<DesktopImageResult<DesktopImageGenerationDto>> {
    if (this.disposed) return this.failure('SERVICE_UNAVAILABLE', '生图服务已关闭')
    const parsed = DesktopGenerateImageInputSchema.safeParse(input)
    if (!parsed.success) return this.failure('VALIDATION_FAILED', '请填写有效的模型和提示词')
    if (this.active) return this.failure('REQUEST_IN_PROGRESS', '已有图片正在生成，请稍候或取消')
    const config = this.options.getProviderConfig()
    if (!config) return this.failure('NOT_CONFIGURED', '请先在供应商配置中保存地址和密钥')
    const data = parsed.data
    if (config.provider !== 'openai-compatible' && data.endpoint !== undefined) {
      return this.failure('VALIDATION_FAILED', '端点选项仅适用于 OpenAI 兼容供应商')
    }
    let adapter: ImageGenerationModelPort
    try {
      adapter = (this.options.createAdapter ?? createImageGenerationAdapter)({ ...config, modelId: data.modelId }, {
        ...(config.provider === 'openai-compatible' ? { endpoint: data.endpoint ?? 'images' } : {})
      })
    } catch (error) {
      return this.failure('UNSUPPORTED_CAPABILITY', '当前供应商或模型不支持所选生图方式')
    }
    const kernel = new ImageGenerationKernel(adapter)
    const active = { requestId: data.requestId, kernel }
    this.active = active
    try {
      const result = await kernel.generate({ requestId: data.requestId, prompt: data.prompt }, AbortSignal.timeout(this.options.timeoutMs ?? 180000))
      if (!result.success) {
        if (result.error.code === 'REQUEST_ABORTED') return this.failure('CANCELLED', '图片生成已取消或超时')
        if (result.error.code === 'UNSUPPORTED_CAPABILITY') return this.failure('UNSUPPORTED_CAPABILITY', '供应商不支持当前生图方式')
        return this.failure('MODEL_REQUEST_FAILED', `图片生成失败：${result.error.message} (${result.error.code})。请核对生图模型及端点。`)
      }
      if (this.disposed) return this.failure('CANCELLED', '生图服务已关闭')
      const value = { requestId: result.requestId, modelId: result.modelId, output: result.output }
      this.latestResult = structuredClone(value)
      return { ok: true, value }
    } finally {
      if (this.active === active) this.active = null
    }
  }

  public cancel(requestId: string): DesktopImageResult<{ cancelled: boolean }> {
    return { ok: true, value: { cancelled: this.active?.requestId === requestId ? this.active.kernel.cancel(requestId) : false } }
  }

  public async save(requestId: string, imageIndex: number): Promise<DesktopImageResult<{ saved: boolean }>> {
    const image = this.latestResult?.requestId === requestId ? this.latestResult.output.images[imageIndex] : undefined
    if (!image) return this.failure('RESULT_NOT_FOUND', '图片已过期，请重新生成')
    if (image.type !== 'base64') return this.failure('UNSUPPORTED_CAPABILITY', '供应商返回图片外链；本版本不自动下载远程文件，请复制链接自行保存')
    if (!this.options.saveImage) return this.failure('SAVE_FAILED', '图片保存服务不可用')
    try { return { ok: true, value: { saved: await this.options.saveImage(image, imageIndex) } } }
    catch { return this.failure('SAVE_FAILED', '保存图片失败，请检查目标文件夹权限') }
  }

  public dispose(): void {
    this.disposed = true
    if (this.active) this.active.kernel.cancel(this.active.requestId)
    this.latestResult = null
  }

  private failure<T>(code: Extract<DesktopImageResult<T>, { ok: false }>['error']['code'], message: string): DesktopImageResult<T> {
    return { ok: false, error: { code, message } }
  }
}
