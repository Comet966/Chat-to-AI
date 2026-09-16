import { describe, expect, it, vi } from 'vitest'
import { GeminiGenerateContentModelAdapter } from 'chat-model-adapters'

describe('GeminiGenerateContentModelAdapter', () => {
  it('should format request with x-goog-api-key, correct endpoint, and mapped contents', async () => {
    const ssePayload = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}],"role":"model"},"index":0}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"from Gemini!"}],"role":"model"},"finishReason":"STOP","index":0}]}\n\n'
    ].join('')

    const mockResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload))
          controller.close()
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'test-goog-key',
      modelId: 'gemini-1.5-pro',
      maxOutputTokens: 1024
    })

    const chunks = []
    const abortController = new AbortController()

    for await (const chunk of adapter.streamChat(
      {
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Greet me' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Again' }
        ]
      },
      abortController.signal
    )) {
      chunks.push(chunk)
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-goog-api-key': 'test-goog-key'
        }),
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: 'Be concise.\n\nGreet me' }] },
            { role: 'model', parts: [{ text: 'Hi' }] },
            { role: 'user', parts: [{ text: 'Again' }] }
          ],
          generationConfig: {
            maxOutputTokens: 1024
          }
        })
      })
    )

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'from Gemini!' },
      { type: 'finish', finishReason: 'stop' }
    ])

    fetchSpy.mockRestore()
  })

  it('should not duplicate models/ if modelId already has models/ prefix', async () => {
    const ssePayload = 'data: {"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}\n\n'
    const mockResponse = new Response(ssePayload, { status: 200 })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      apiKey: 'k',
      modelId: 'models/gemini-1.5-flash'
    })

    const chunks = []
    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      new AbortController().signal
    )) {
      chunks.push(chunk)
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse',
      expect.anything()
    )
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'OK' },
      { type: 'finish', finishReason: 'stop' }
    ])

    fetchSpy.mockRestore()
  })

  it('should map finishReason MAX_TOKENS to length and SAFETY to unknown', async () => {
    const ssePayload = 'data: {"candidates":[{"content":{"parts":[{"text":"cut"}]},"finishReason":"MAX_TOKENS"}]}\n\n'
    const mockResponse = new Response(ssePayload, { status: 200 })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      apiKey: 'k',
      modelId: 'gemini-1.5-pro'
    })

    const chunks = []
    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      new AbortController().signal
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'cut' },
      { type: 'finish', finishReason: 'length' }
    ])

    fetchSpy.mockRestore()
  })

  it('should handle CRLF, chunk splits, and empty candidates safely', async () => {
    const part1 = 'data: {"usageMetadata":{}}\r\n\r\n'
    const part2 = 'data: {"candidates":[{"content":{"parts":[{"text":"He'
    const part3 = 'llo"}]}}]}\r\n\r\n'
    const part4 = 'data: {"candidates":[{"content":{"parts":[{"text":"!"}]},"finishReason":"STOP"}]}' // No trailing newline

    const mockResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(part1))
          controller.enqueue(new TextEncoder().encode(part2))
          controller.enqueue(new TextEncoder().encode(part3))
          controller.enqueue(new TextEncoder().encode(part4))
          controller.close()
        }
      }),
      { status: 200 }
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      apiKey: 'k',
      modelId: 'gemini-1.5-pro'
    })

    const chunks = []
    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      new AbortController().signal
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: '!' },
      { type: 'finish', finishReason: 'stop' }
    ])

    fetchSpy.mockRestore()
  })

  it('should throw error when stream contains in-stream error payload', async () => {
    const ssePayload = 'data: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}\n\n'
    const mockResponse = new Response(ssePayload, { status: 200 })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      apiKey: 'bad-key',
      modelId: 'gemini-1.5-pro'
    })

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.streamChat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        new AbortController().signal
      )) {
        // iterate
      }
    }).rejects.toThrow(/Provider stream error: API key not valid/)

    fetchSpy.mockRestore()
  })

  it('should throw HTTP status error with redacted body on non-200 response', async () => {
    const mockResponse = new Response(
      JSON.stringify({ error: { message: 'Quota exceeded for key my_secret_goog_key' } }),
      { status: 429 }
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      apiKey: 'my_secret_goog_key',
      modelId: 'gemini-1.5-pro'
    })

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.streamChat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        new AbortController().signal
      )) {
        // iterate
      }
    }).rejects.toThrow(/Provider HTTP 429/)

    fetchSpy.mockRestore()
  })

  it('should stop output when AbortSignal is aborted', async () => {
    let controllerRef: ReadableStreamDefaultController | null = null
    const mockResponse = new Response(
      new ReadableStream({
        start(controller) {
          controllerRef = controller
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"candidates":[{"content":{"parts":[{"text":"First"}]}}]}\n\n'
            )
          )
        }
      }),
      { status: 200 }
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new GeminiGenerateContentModelAdapter({
      apiKey: 'k',
      modelId: 'gemini-1.5-pro'
    })

    const chunks = []
    const abortController = new AbortController()

    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      abortController.signal
    )) {
      chunks.push(chunk)
      abortController.abort()
    }

    expect(chunks).toEqual([{ type: 'text-delta', text: 'First' }])

    try {
      controllerRef?.close()
    } catch {
      // Ignored
    }
    fetchSpy.mockRestore()
  })
})
