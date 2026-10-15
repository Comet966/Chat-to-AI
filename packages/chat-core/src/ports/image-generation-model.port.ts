import type { ImageGenerationInput, ImageGenerationOutput } from 'chat-contracts'

export interface ImageGenerationModelPort {
  readonly modelId: string
  generateImage(input: ImageGenerationInput, signal: AbortSignal): Promise<ImageGenerationOutput>
}
