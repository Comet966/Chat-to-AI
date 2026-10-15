import { z } from 'zod'
import { ImageGenerationOutputSchema } from 'chat-contracts'

const IdSchema = z.string().min(1).max(256)
export const DesktopGenerateImageInputSchema = z.object({
  requestId: IdSchema, prompt: z.string().min(1).max(32000).refine((value) => !!value.trim(), 'Prompt cannot be blank'),
  modelId: IdSchema.refine((value) => !!value.trim(), 'Model cannot be blank'),
  endpoint: z.enum(['images', 'chat-completions']).optional()
}).strict()
export const DesktopCancelImageInputSchema = z.object({ requestId: IdSchema }).strict()
export const DesktopSaveImageInputSchema = z.object({ requestId: IdSchema, imageIndex: z.number().int().min(0).max(3) }).strict()

const ErrorResultSchema = z.object({
  ok: z.literal(false), error: z.object({
    code: z.enum(['NOT_CONFIGURED', 'REQUEST_IN_PROGRESS', 'VALIDATION_FAILED', 'UNAUTHORIZED_SENDER',
      'MODEL_REQUEST_FAILED', 'UNSUPPORTED_CAPABILITY', 'CANCELLED', 'RESULT_NOT_FOUND', 'SAVE_FAILED', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']),
    message: z.string().max(2000)
  }).strict()
}).strict()

export const DesktopImageGenerationResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.object({
    requestId: IdSchema, modelId: IdSchema, output: ImageGenerationOutputSchema
  }).strict() }).strict(), ErrorResultSchema
])
export const DesktopImageCancelResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.object({ cancelled: z.boolean() }).strict() }).strict(), ErrorResultSchema
])
export const DesktopImageSaveResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.object({ saved: z.boolean() }).strict() }).strict(), ErrorResultSchema
])
