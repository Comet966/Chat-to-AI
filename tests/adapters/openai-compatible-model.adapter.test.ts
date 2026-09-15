import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleModelAdapter } from '../../apps/desktop/src/main/openai-compatible-model.adapter.js'

describe('OpenAICompatibleModelAdapter', () => {
  it('should parse streaming SSE chunks and finish properly', async () => {
    const ssePayload = [
      'data: {"id":"chat-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat-1","choices":[{"index":0,"delta":{"content":" from adapter!"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
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

    const adapter = new OpenAICompatibleModelAdapter({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      modelId: 'test-model'
    })

    const chunks = []
    const abortController = new AbortController()

    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      abortController.signal
    )) {
      chunks.push(chunk)
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json'
        })
      })
    )

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' from adapter!' },
      { type: 'finish', finishReason: 'stop' }
    ])

    fetchSpy.mockRestore()
  })

  it('should throw an error on non-200 provider response', async () => {
    const mockResponse = new Response('Unauthorized key', { status: 401 })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new OpenAICompatibleModelAdapter({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'bad-key',
      modelId: 'test-model'
    })

    const abortController = new AbortController()
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.streamChat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        abortController.signal
      )) {
        // iterate
      }
    }).rejects.toThrow('Provider HTTP 401')

    fetchSpy.mockRestore()
  })
})
