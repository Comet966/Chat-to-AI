import { z } from 'zod'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 10
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export const HttpUrlSchema = z.string().max(2048).url().refine((value) => {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}, 'Only HTTP(S) URLs without embedded credentials are allowed')

export function base64ByteLength(data: string): number {
  return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
}

export const Base64DataSchema = z.string().min(1)
  .max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4)
  .refine((value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), 'Expected padded base64 data, not a data URL')
  .refine((value) => base64ByteLength(value) <= MAX_ATTACHMENT_BYTES, 'Attachment exceeds byte limit')

export const Base64SourceSchema = z.object({ type: z.literal('base64'), data: Base64DataSchema }).strict()
export const MediaSourceSchema = z.discriminatedUnion('type', [
  Base64SourceSchema,
  z.object({ type: z.literal('url'), url: HttpUrlSchema }).strict()
])

export const ChatAttachmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'), mediaType: z.enum(IMAGE_MEDIA_TYPES), source: MediaSourceSchema,
    detail: z.enum(['auto', 'low', 'high']).optional()
  }).strict(),
  z.object({
    type: z.literal('document'), mediaType: z.literal('application/pdf'), source: MediaSourceSchema,
    filename: z.string().min(1).max(255).refine((value) => !/[\x00-\x1f/\\]/.test(value), 'Expected a filename, not a local path').optional()
  }).strict(),
  z.object({
    type: z.literal('audio'), mediaType: z.enum(['audio/wav', 'audio/mpeg']), source: Base64SourceSchema
  }).strict()
])

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>
