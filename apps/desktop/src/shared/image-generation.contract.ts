import type { ImageGenerationOutput } from 'chat-contracts'

export interface DesktopGenerateImageInput {
  requestId: string
  prompt: string
  modelId: string
  endpoint?: 'images' | 'chat-completions'
}

export interface DesktopImageGenerationDto {
  requestId: string
  modelId: string
  output: ImageGenerationOutput
}

export type DesktopImageErrorCode =
  | 'NOT_CONFIGURED' | 'REQUEST_IN_PROGRESS' | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED_SENDER' | 'MODEL_REQUEST_FAILED' | 'UNSUPPORTED_CAPABILITY'
  | 'CANCELLED' | 'RESULT_NOT_FOUND' | 'SAVE_FAILED' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR'

export type DesktopImageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: DesktopImageErrorCode; message: string } }

export interface DesktopImageGenerationApi {
  generate(input: DesktopGenerateImageInput): Promise<DesktopImageResult<DesktopImageGenerationDto>>
  cancel(input: { requestId: string }): Promise<DesktopImageResult<{ cancelled: boolean }>>
  save(input: { requestId: string; imageIndex: number }): Promise<DesktopImageResult<{ saved: boolean }>>
}
