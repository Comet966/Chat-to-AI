import { describe, expect, it } from 'vitest'
import { parseSseStream, type ServerSentEvent } from 'chat-model-adapters'

function createStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    }
  })
}

async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = []
  for await (const evt of parseSseStream(stream, signal)) {
    events.push(evt)
  }
  return events
}

describe('parseSseStream', () => {
  it('should parse standard single-line data events with LF', async () => {
    const stream = createStreamFromChunks([
      'data: hello\n\ndata: world\n\n'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { data: 'hello' },
      { data: 'world' }
    ])
  })

  it('should parse events with CRLF line endings', async () => {
    const stream = createStreamFromChunks([
      'data: first\r\n\r\ndata: second\r\n\r\n'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { data: 'first' },
      { data: 'second' }
    ])
  })

  it('should parse named events and event id', async () => {
    const stream = createStreamFromChunks([
      'event: message_start\nid: 1\ndata: {"type":"start"}\n\n',
      'event: content_block_delta\ndata: {"delta":"hi"}\n\n'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { event: 'message_start', id: '1', data: '{"type":"start"}' },
      { event: 'content_block_delta', data: '{"delta":"hi"}' }
    ])
  })

  it('should join multiline data fields with newline', async () => {
    const stream = createStreamFromChunks([
      'data: line 1\ndata: line 2\ndata: line 3\n\n'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { data: 'line 1\nline 2\nline 3' }
    ])
  })

  it('should ignore comment lines and strip optional leading space', async () => {
    const stream = createStreamFromChunks([
      ': this is a comment\n',
      ': another comment\n',
      'data:no-space-after-colon\n\n',
      'data: with-space\n\n'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { data: 'no-space-after-colon' },
      { data: 'with-space' }
    ])
  })

  it('should handle chunks split arbitrarily across network boundaries', async () => {
    const stream = createStreamFromChunks([
      'eve',
      'nt: cust',
      'om\r',
      '\nda',
      'ta: {"part":',
      '1}\r\n',
      '\r\ndata: {"par',
      't":2}\n\n'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { event: 'custom', data: '{"part":1}' },
      { data: '{"part":2}' }
    ])
  })

  it('should flush and dispatch trailing event without terminal newline', async () => {
    const stream = createStreamFromChunks([
      'data: [DONE]'
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([
      { data: '[DONE]' }
    ])
  })

  it('should handle AbortSignal during stream processing without leaking reader', async () => {
    const abortController = new AbortController()
    let streamCancelled = false

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: chunk1\n\n'))
        controller.enqueue(new TextEncoder().encode('data: chunk2\n\n'))
      },
      cancel() {
        streamCancelled = true
      }
    })

    const events: ServerSentEvent[] = []
    for await (const evt of parseSseStream(stream, abortController.signal)) {
      events.push(evt)
      abortController.abort()
    }

    expect(events).toEqual([{ data: 'chunk1' }])
    expect(streamCancelled).toBe(true)
  })
})
