import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModelAdapter, type ModelProviderKind } from 'chat-model-adapters'
import type { ChatAttachment } from 'chat-contracts'

const base64 = { type: 'base64' as const, data: 'aGVsbG8=' }
const image: ChatAttachment = { type: 'image', mediaType: 'image/png', source: base64 }
const pdf: ChatAttachment = { type: 'document', mediaType: 'application/pdf', source: base64, filename: 'notes.pdf' }
const audio: ChatAttachment = { type: 'audio', mediaType: 'audio/wav', source: base64 }
const adapter = (provider: ModelProviderKind) => createModelAdapter({ provider, baseUrl: 'https://example.com', apiKey: 'test-key', modelId: 'test-model', maxOutputTokens: 1024 })

async function run(provider: ModelProviderKind, attachments?: ChatAttachment[], content = 'Describe this') {
  const end = provider === 'anthropic' ? { type: 'message_stop' } : provider === 'gemini' ? { candidates: [{ finishReason: 'STOP' }] } : '[DONE]'
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`data: ${typeof end === 'string' ? end : JSON.stringify(end)}\n\n`))
  const chunks = []
  for await (const chunk of adapter(provider).streamChat({ messages: [
    { role: 'system', content: 'Be helpful' },
    { role: 'user', content, ...(attachments ? { attachments } : {}) }
  ] }, new AbortController().signal)) chunks.push(chunk)
  const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
  expect(chunks).toEqual([{ type: 'finish', finishReason: 'stop' }])
  return body
}

afterEach(() => vi.restoreAllMocks())

describe('provider multimodal input mapping', () => {
  it('maps OpenAI inline image, PDF, and audio to native content parts', async () => {
    const body = await run('openai-compatible', [image, pdf, audio])
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be helpful' })
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'Describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
      { type: 'file', file: { filename: 'notes.pdf', file_data: 'data:application/pdf;base64,aGVsbG8=' } },
      { type: 'input_audio', input_audio: { format: 'wav', data: 'aGVsbG8=' } }
    ])
    expect(body.messages[1].attachments).toBeUndefined()
  })

  it('maps OpenAI image URLs and mp3 audio without downloading media locally', async () => {
    const body = await run('openai-compatible', [
      { ...image, source: { type: 'url', url: 'https://example.com/a.png' }, detail: 'high' },
      { ...audio, mediaType: 'audio/mpeg' }
    ], '')
    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.com/a.png', detail: 'high' } },
      { type: 'input_audio', input_audio: { format: 'mp3', data: 'aGVsbG8=' } }
    ])
  })

  it('maps Anthropic inline images and PDF documents while separating system instructions', async () => {
    const body = await run('anthropic', [image, pdf])
    expect(body.system).toBe('Be helpful')
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Describe this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'aGVsbG8=' } }
    ])
  })

  it('maps Anthropic URL references and attachment-only input', async () => {
    const body = await run('anthropic', [
      { ...image, source: { type: 'url', url: 'https://example.com/a.png' } },
      { ...pdf, source: { type: 'url', url: 'https://example.com/a.pdf' } }
    ], '')
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      { type: 'document', source: { type: 'url', url: 'https://example.com/a.pdf' } }
    ])
  })

  it('maps Gemini inline media and preserves attachments when merging system text', async () => {
    const body = await run('gemini', [image, pdf, audio])
    expect(body.contents[0].parts).toEqual([
      { text: 'Be helpful\n\nDescribe this' },
      { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
      { inlineData: { mimeType: 'application/pdf', data: 'aGVsbG8=' } },
      { inlineData: { mimeType: 'audio/wav', data: 'aGVsbG8=' } }
    ])
  })

  it.each([
    ['anthropic', audio],
    ['openai-compatible', { ...pdf, source: { type: 'url', url: 'https://example.com/a.pdf' } }],
    ['gemini', { ...image, source: { type: 'url', url: 'https://example.com/a.png' } }]
  ] as [ModelProviderKind, ChatAttachment][])('rejects unsupported %s media before network I/O', async (provider, attachment) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(async () => {
      for await (const _ of adapter(provider).streamChat({ messages: [{ role: 'user', content: 'Describe', attachments: [attachment] }] }, new AbortController().signal)) { /* consume */ }
    }).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each(['openai-compatible', 'anthropic', 'gemini'] as const)('retains legacy text request shape for %s', async (provider) => {
    const body = await run(provider)
    if (provider === 'gemini') expect(body.contents[0].parts).toEqual([{ text: 'Be helpful\n\nDescribe this' }])
    else expect(body.messages.at(-1).content).toBe('Describe this')
  })
})
