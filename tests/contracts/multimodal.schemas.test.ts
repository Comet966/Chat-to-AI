import { describe, expect, it } from 'vitest'
import { StartChatCommandSchema, GenerateImageCommandSchema, MAX_ATTACHMENT_BYTES, type ChatAttachment } from 'chat-contracts'

const image: ChatAttachment = { type: 'image', mediaType: 'image/png', source: { type: 'base64', data: 'aGVsbG8=' } }
const command = (messages: unknown[]) => ({ requestId: 'req', conversationId: 'conv', assistantMessageId: 'asst', messages })

describe('multimodal input validation', () => {
  it('accepts legacy text, mixed media, and attachment-only user input', () => {
    for (const message of [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Describe', attachments: [image] },
      { role: 'user', content: '', attachments: [image] },
      { role: 'user', content: '', attachments: [{ type: 'document', mediaType: 'application/pdf', source: { type: 'url', url: 'https://example.com/a.pdf' } }] },
      { role: 'user', content: '', attachments: [{ type: 'audio', mediaType: 'audio/wav', source: { type: 'base64', data: 'aGVsbG8=' } }] }
    ]) expect(StartChatCommandSchema.safeParse(command([message])).success).toBe(true)
  })

  it.each([
    { ...image, source: { type: 'url', url: 'not a url' } },
    { ...image, source: { type: 'url', url: 'file:///secret.png' } },
    { ...image, source: { type: 'url', url: 'javascript:alert(1)' } },
    { ...image, source: { type: 'url', url: 'https://user:password@example.com/a.png' } },
    { ...image, mediaType: 'text/html' },
    { ...image, source: { type: 'base64', data: 'data:image/png;base64,aGVsbG8=' } },
    { ...image, source: { type: 'base64', data: '***' } },
    { ...image, source: { type: 'base64', data: 'a=' } },
    { ...image, apiKey: 'secret' },
    { type: 'document', mediaType: 'application/pdf', filename: '../../private.pdf', source: image.source },
    { type: 'audio', mediaType: 'audio/wav', source: { type: 'url', url: 'https://example.com/a.wav' } }
  ])('rejects invalid, unsafe, or unknown media fields (%#)', (attachment) => {
    expect(StartChatCommandSchema.safeParse(command([{ role: 'user', content: 'hi', attachments: [attachment] }])).success).toBe(false)
  })

  it('rejects empty messages, non-user attachments, and excessive attachment counts', () => {
    expect(StartChatCommandSchema.safeParse(command([])).success).toBe(false)
    for (const messages of [
      [{ role: 'user', content: '', attachments: [] }],
      [{ role: 'system', content: 'system', attachments: [image] }, { role: 'user', content: 'hi' }],
      [{ role: 'assistant', content: 'response', attachments: [image] }, { role: 'user', content: 'hi' }],
      [{ role: 'user', content: 'hi', attachments: Array(11).fill(image) }]
    ]) expect(StartChatCommandSchema.safeParse(command(messages)).success).toBe(false)
  })

  it('limits each attachment and total inline bytes separately from text limits', () => {
    const oversized = { ...image, source: { type: 'base64', data: 'A'.repeat(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4) } }
    expect(StartChatCommandSchema.safeParse(command([{ role: 'user', content: 'hi', attachments: [oversized] }])).success).toBe(false)
    const bigImage = { ...image, source: { type: 'base64', data: 'A'.repeat(24 * 1024 * 1024) } }
    const result = StartChatCommandSchema.safeParse(command([{ role: 'user', content: 'hi', attachments: [bigImage, bigImage, bigImage] }]))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('Total attachment bytes'))).toBe(true)
  })
})

describe('image generation request validation', () => {
  it('accepts a minimal prompt and optional bounded generation options', () => {
    expect(GenerateImageCommandSchema.safeParse({ requestId: 'img', prompt: 'A blue square' }).success).toBe(true)
    expect(GenerateImageCommandSchema.safeParse({ requestId: 'img', prompt: 'Square', n: 2, size: '1024x1024', quality: 'high', outputFormat: 'webp' }).success).toBe(true)
  })
  it.each([{ prompt: ' ' }, { n: 0 }, { n: 5 }, { size: '0x0' }, { outputFormat: 'html' }, { apiKey: 'secret' }])('rejects invalid options (%#)', (options) => {
    expect(GenerateImageCommandSchema.safeParse({ requestId: 'img', prompt: 'Square', ...options }).success).toBe(false)
  })
})
