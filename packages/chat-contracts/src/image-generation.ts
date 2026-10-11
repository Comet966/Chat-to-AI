import { z } from 'zod'
import type { ChatPublicError } from './chat.events.js'
import { Base64DataSchema, HttpUrlSchema, IMAGE_MEDIA_TYPES } from './multimodal.schemas.js'

export const GenerateImageCommandSchema = z.object({
  requestId: z.string().min(1),
  prompt: z.string().min(1).max(32000).refine((value) => !!value.trim(), 'Prompt cannot be blank'),
  n: z.number().int().min(1).max(4).optional(),
  size: z.string().regex(/^(auto|[1-9]\d{1,3}x[1-9]\d{1,3})$/).optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'standard', 'hd']).optional(),
  outputFormat: z.enum(['png', 'jpeg', 'webp']).optional()
}).strict()

export const GeneratedImageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('base64'), mediaType: z.enum(IMAGE_MEDIA_TYPES), data: Base64DataSchema }).strict(),
  z.object({ type: z.literal('url'), url: HttpUrlSchema }).strict()
])

export const ImageGenerationOutputSchema = z.object({
  images: z.array(GeneratedImageSchema).min(1).max(4),
  text: z.string().max(100000).optional()
}).strict()

export type GenerateImageCommand = z.infer<typeof GenerateImageCommandSchema>
export type ImageGenerationInput = Omit<GenerateImageCommand, 'requestId'>
export type GeneratedImage = z.infer<typeof GeneratedImageSchema>
export type ImageGenerationOutput = z.infer<typeof ImageGenerationOutputSchema>
export type GenerateImageResult =
  | { requestId: string; success: true; modelId: string; output: ImageGenerationOutput }
  | { requestId: string; success: false; error: ChatPublicError }
