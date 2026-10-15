import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageGenerationAdapter, type ProviderConfig, type OpenAIImageEndpoint } from 'chat-model-adapters'
import { ImageGenerationKernel } from 'chat-core'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const config: ProviderConfig = { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'test-secret-key', modelId: 'image-model', maxOutputTokens: 1024 }
const make = (endpoint?: OpenAIImageEndpoint) => createImageGenerationAdapter(config, { endpoint })
const generate = (adapter = make()) => adapter.generateImage({ prompt: 'A blue square' }, new AbortController().signal)

afterEach(() => vi.restoreAllMocks())

describe('image generation protocol adapters', () => {
  it('maps the Images API request and parses base64 and URL results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [{ b64_json: png }, { url: 'https://example.com/result.png' }] }))
    expect(await generate()).toEqual({ images: [
      { type: 'base64', mediaType: 'image/png', data: png },
      { type: 'url', url: 'https://example.com/result.png' }
    ] })
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/v1/images/generations', expect.objectContaining({
      body: JSON.stringify({ model: 'image-model', prompt: 'A blue square' }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret-key' }
    }))
  })

  it('passes explicit image options and preserves MIME metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ output_format: 'jpeg', data: [{ b64_json: 'aGVsbG8=' }] }))
    expect(await make().generateImage({ prompt: 'Square', n: 1, size: '1024x1024', quality: 'high', outputFormat: 'jpeg' }, new AbortController().signal))
      .toMatchObject({ images: [{ type: 'base64', mediaType: 'image/jpeg' }] })
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toMatchObject({ n: 1, size: '1024x1024', quality: 'high', output_format: 'jpeg' })
  })

  it('normalizes an unversioned base URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [{ b64_json: png }] }))
    await generate(createImageGenerationAdapter({ ...config, baseUrl: 'https://example.com/' }))
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/v1/images/generations')
  })

  it('parses the local gateway chat image extension with null text content', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ message: {
      role: 'assistant', content: null, images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` }, index: 0 }]
    } }] }))
    expect(await generate(make('chat-completions'))).toEqual({ images: [{ type: 'base64', mediaType: 'image/png', data: png }] })
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/v1/chat/completions')
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      model: 'image-model', messages: [{ role: 'user', content: 'A blue square' }], modalities: ['text', 'image'], stream: false
    })
  })

  it('preserves text and images from a structured chat content array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ message: { content: [
      { type: 'text', text: 'Here it is.' }, { type: 'image_url', image_url: { url: 'https://example.com/result.jpg' } }
    ] } }] }))
    expect(await generate(make('chat-completions'))).toEqual({ images: [{ type: 'url', url: 'https://example.com/result.jpg' }], text: 'Here it is.' })
  })

  it('parses native Gemini inline images but ignores thought-only image parts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ candidates: [{ content: { parts: [
      { text: 'Thinking', thought: true }, { text: 'Generated.' },
      { inlineData: { mimeType: 'image/png', data: png }, thought: true },
      { inlineData: { mimeType: 'image/png', data: png } }
    ] } }] }))
    const native = createImageGenerationAdapter({ ...config, provider: 'gemini', baseUrl: 'https://example.com/v1beta', modelId: 'models/image-model' })
    expect(await generate(native)).toEqual({ images: [{ type: 'base64', mediaType: 'image/png', data: png }], text: 'Generated.' })
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/v1beta/models/image-model:generateContent')
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toMatchObject({ generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
    expect(fetchSpy.mock.calls[0][1]!.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'test-secret-key' })
  })

  it.each([
    { data: [] },
    { data: [{}] },
    { data: [{ b64_json: 'invalid!!' }] },
    { data: [{ url: 'file:///secret' }] },
    { data: [{ url: 'data:text/html;base64,aGVsbG8=' }] },
    { error: { message: 'test-secret-key' } }
  ])('rejects invalid image responses (%#)', async (response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response))
    await expect(generate()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('does not treat a text-only answer as a successful generated image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ message: { content: 'Cannot generate an image' } }] }))
    await expect(generate(make('chat-completions'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('rejects malformed JSON and never silently falls back to another billed endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json'))
    await expect(generate()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported providers and options before network I/O', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(() => createImageGenerationAdapter({ ...config, provider: 'anthropic' })).toThrow(/text-to-image/)
    await expect(make('chat-completions').generateImage({ prompt: 'Square', n: 2 }, new AbortController().signal)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    await expect(createImageGenerationAdapter({ ...config, provider: 'gemini' }).generateImage({ prompt: 'Square', size: '1024x1024' }, new AbortController().signal)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('validates direct adapter input and endpoint configuration before network I/O', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(make().generateImage({ prompt: ' ' }, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(() => createImageGenerationAdapter({ ...config, provider: 'gemini' }, { endpoint: 'images' })).toThrow(/endpoint selection/)
    expect(() => make('unknown' as OpenAIImageEndpoint)).toThrow(/Invalid image generation endpoint/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('propagates cancellation through an in-flight HTTP request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const kernel = new ImageGenerationKernel(make())
    const pending = kernel.generate({ requestId: 'img', prompt: 'Square' })
    expect(kernel.cancel('img')).toBe(true)
    expect(await pending).toMatchObject({ success: false, error: { code: 'REQUEST_ABORTED' } })
  })

  it('honors abort and strips a provider-echoed key from adapter and public errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('test-secret-key', { status: 401 }))
    await expect(make().generateImage({ prompt: 'Square' }, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(generate()).rejects.toThrow('Provider HTTP 401')
    fetchSpy.mockResolvedValue(new Response('test-secret-key', { status: 401 }))
    const result = await new ImageGenerationKernel(make()).generate({ requestId: 'req', prompt: 'Square' })
    expect(result).toMatchObject({ success: false, error: { code: 'PROVIDER_UNAUTHORIZED' } })
    expect(JSON.stringify(result)).not.toContain('test-secret-key')
  })
})
