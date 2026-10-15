import { GenerateImageCommandSchema, ImageGenerationOutputSchema, type GenerateImageCommand, type GenerateImageResult } from 'chat-contracts'
import type { ImageGenerationModelPort } from './ports/image-generation-model.port.js'
import { toPublicModelError } from './model-error.js'

/** Independent of chat history, transport, and UI. Does not simulate image streaming. */
export class ImageGenerationKernel {
  private active: { requestId: string; controller: AbortController } | null = null

  constructor(private readonly model: ImageGenerationModelPort) {}

  public async generate(command: GenerateImageCommand, signal?: AbortSignal): Promise<GenerateImageResult> {
    const parsed = GenerateImageCommandSchema.safeParse(command)
    if (!parsed.success) return {
      requestId: command?.requestId ?? '', success: false,
      error: { code: 'INVALID_REQUEST', message: parsed.error.issues[0].message, retryable: false }
    }
    const { requestId, ...input } = parsed.data
    if (this.active) return {
      requestId, success: false,
      error: { code: 'REQUEST_IN_PROGRESS', message: 'An image request is already in progress', retryable: true }
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    this.active = { requestId, controller }
    try {
      controller.signal.throwIfAborted()
      const output = await this.model.generateImage(input, controller.signal)
      controller.signal.throwIfAborted()
      const validOutput = ImageGenerationOutputSchema.safeParse(output)
      if (!validOutput.success) return {
        requestId, success: false,
        error: { code: 'INVALID_RESPONSE', message: 'Provider returned invalid or empty image data', retryable: false }
      }
      return { requestId, success: true, modelId: this.model.modelId, output: validOutput.data }
    } catch (error) {
      return { requestId, success: false, error: toPublicModelError(error, controller.signal.aborted) }
    } finally {
      signal?.removeEventListener('abort', abort)
      this.active = null
    }
  }

  public cancel(requestId: string): boolean {
    if (!this.active || this.active.requestId !== requestId || this.active.controller.signal.aborted) return false
    this.active.controller.abort()
    return true
  }
}
