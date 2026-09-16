import { describe, expect, it, vi } from 'vitest'
import { AnthropicMessagesModelAdapter } from 'chat-model-adapters'

describe('AnthropicMessagesModelAdapter', () => {
  it('should format request with auth headers, anthropic-version, max_tokens, and extract system messages', async () => {
    const ssePayload = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"from Claude!"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
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

    const adapter = new AnthropicMessagesModelAdapter({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-ant-key',
      modelId: 'claude-3-5-sonnet-20241022',
      maxOutputTokens: 2048,
      anthropicVersion: '2023-06-01'
    })

    const chunks = []
    const abortController = new AbortController()

    for await (const chunk of adapter.streamChat(
      {
        messages: [
          { role: 'system', content: 'You are an AI assistant.' },
          { role: 'user', content: 'Say hello' }
        ]
      },
      abortController.signal
    )) {
      chunks.push(chunk)
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-ant-key',
          'x-api-key': 'test-ant-key',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          messages: [{ role: 'user', content: 'Say hello' }],
          stream: true,
          system: 'You are an AI assistant.'
        })
      })
    )

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'from Claude!' },
      { type: 'finish', finishReason: 'stop' }
    ])

    fetchSpy.mockRestore()
  })

  it('should map stop_reason max_tokens to length finishReason', async () => {
    const ssePayload = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"truncated"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    const mockResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload))
          controller.close()
        }
      }),
      { status: 200 }
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new AnthropicMessagesModelAdapter({
      apiKey: 'test-key',
      modelId: 'claude-3-5-haiku-20241022'
    })

    const chunks = []
    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      new AbortController().signal
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'truncated' },
      { type: 'finish', finishReason: 'length' }
    ])

    fetchSpy.mockRestore()
  })

  it('should handle CRLF, chunk splits, and safely ignore unknown events', async () => {
    const part1 = 'event: ping\r\ndata: {"type":"ping"}\r\n\r\n'
    const part2 = 'event: unknown_event\r\ndata: {"something":"weird"}\r\n\r\n'
    const part3 = 'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK'
    const part4 = '!"}}\r\n\r\nevent: message_stop\r\ndata: {"type":"message_stop"}' // No trailing newline

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

    const adapter = new AnthropicMessagesModelAdapter({
      apiKey: 'test-key',
      modelId: 'claude-3-5-sonnet-20241022'
    })

    const chunks = []
    for await (const chunk of adapter.streamChat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      new AbortController().signal
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'OK!' },
      { type: 'finish', finishReason: 'stop' }
    ])

    fetchSpy.mockRestore()
  })

  it('should fail when stream contains an error event', async () => {
    const ssePayload = [
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'
    ].join('')

    const mockResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload))
          controller.close()
        }
      }),
      { status: 200 }
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new AnthropicMessagesModelAdapter({
      apiKey: 'test-key',
      modelId: 'claude-3-5-sonnet-20241022'
    })

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.streamChat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        new AbortController().signal
      )) {
        // iterate
      }
    }).rejects.toThrow('Provider stream error: Overloaded')

    fetchSpy.mockRestore()
  })

  it('should throw HTTP status error with redacted body on non-200 response', async () => {
    const mockResponse = new Response(
      JSON.stringify({ error: { message: 'Invalid API key: secret_12345' } }),
      { status: 401 }
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new AnthropicMessagesModelAdapter({
      apiKey: 'secret_12345',
      modelId: 'claude-3-5-sonnet-20241022'
    })

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.streamChat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        new AbortController().signal
      )) {
        // iterate
      }
    }).rejects.toThrow(/Provider HTTP 401/)

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
              'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"First"}}\n\n'
            )
          )
        }
      }),
      { status: 200 }
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const adapter = new AnthropicMessagesModelAdapter({
      apiKey: 'test-key',
      modelId: 'claude-3-5-sonnet-20241022'
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
