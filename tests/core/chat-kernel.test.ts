import { describe, expect, it } from 'vitest'
import { ChatKernel } from 'chat-core'
import type { ChatEvent, ChatRole } from 'chat-contracts'
import type { ChatModelPort } from 'chat-core'

class FakeChatModel implements ChatModelPort {
  public readonly modelId = 'fake-model'
  public receivedMessages: ReadonlyArray<{ role: ChatRole; content: string }> = []
  public chunksToYield: Array<{ type: 'text-delta'; text: string } | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }> = [
    { type: 'text-delta', text: 'Hello' },
    { type: 'text-delta', text: ' world' },
    { type: 'finish', finishReason: 'stop' }
  ]
  public delayMs = 10
  public shouldFail = false
  public failureError: unknown = new Error('Fake network explosion')

  public async *streamChat(
    input: { messages: ReadonlyArray<{ role: ChatRole; content: string }> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  > {
    this.receivedMessages = input.messages

    if (this.shouldFail) {
      throw this.failureError
    }

    for (const chunk of this.chunksToYield) {
      if (signal.aborted) {
        return
      }
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs))
      }
      if (signal.aborted) {
        return
      }
      yield chunk
    }
  }
}

describe('ChatKernel', () => {
  it('should stream deltas in sequential order and complete exactly once', async () => {
    const fakeModel = new FakeChatModel()
    const kernel = new ChatKernel(fakeModel)
    const events: ChatEvent[] = []

    const result = await kernel.start(
      {
        requestId: 'req-1',
        conversationId: 'conv-1',
        assistantMessageId: 'asst-1',
        messages: [{ role: 'user', content: 'Say hello' }]
      },
      {
        emit: (evt) => events.push(evt)
      }
    )

    expect(result.accepted).toBe(true)

    // Wait for streaming to finish
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(events.length).toBeGreaterThanOrEqual(4) // started, delta(0), delta(1), completed
    expect(events[0].type).toBe('chat.stream.started')

    const deltas = events.filter((e): e is Extract<ChatEvent, { type: 'chat.stream.delta' }> => e.type === 'chat.stream.delta')
    expect(deltas.length).toBe(2)
    expect(deltas[0].sequence).toBe(0)
    expect(deltas[0].delta).toBe('Hello')
    expect(deltas[1].sequence).toBe(1)
    expect(deltas[1].delta).toBe(' world')

    const terminalEvents = events.filter((e) => ['chat.stream.completed', 'chat.stream.failed', 'chat.stream.cancelled'].includes(e.type))
    expect(terminalEvents.length).toBe(1)
    expect(terminalEvents[0].type).toBe('chat.stream.completed')

    const state = kernel.getState()
    const assistantMsg = state.messages.find((m) => m.id === 'asst-1')
    expect(assistantMsg?.content).toBe('Hello world')
    expect(assistantMsg?.status).toBe('complete')
  })

  it('should reject a second concurrent request while one is in progress', async () => {
    const fakeModel = new FakeChatModel()
    fakeModel.delayMs = 50
    const kernel = new ChatKernel(fakeModel)
    const events: ChatEvent[] = []

    const start1 = await kernel.start(
      {
        requestId: 'req-1',
        conversationId: 'conv-1',
        assistantMessageId: 'asst-1',
        messages: [{ role: 'user', content: 'First' }]
      },
      {
        emit: (evt) => events.push(evt)
      }
    )
    expect(start1.accepted).toBe(true)

    const start2 = await kernel.start(
      {
        requestId: 'req-2',
        conversationId: 'conv-1',
        assistantMessageId: 'asst-2',
        messages: [{ role: 'user', content: 'Second' }]
      },
      {
        emit: (evt) => events.push(evt)
      }
    )

    expect(start2.accepted).toBe(false)
    if (!start2.accepted) {
      expect(start2.error.code).toBe('REQUEST_IN_PROGRESS')
    }

    // Wait for the first request to complete cleanly
    await new Promise((resolve) => setTimeout(resolve, 200))
  })

  it('should handle cancel and abort the stream gracefully with partial text retained', async () => {
    const fakeModel = new FakeChatModel()
    fakeModel.delayMs = 40
    fakeModel.chunksToYield = [
      { type: 'text-delta', text: 'Part 1' },
      { type: 'text-delta', text: ' Part 2' },
      { type: 'text-delta', text: ' Part 3' },
      { type: 'finish', finishReason: 'stop' }
    ]
    const kernel = new ChatKernel(fakeModel)
    const events: ChatEvent[] = []

    await kernel.start(
      {
        requestId: 'req-cancel',
        conversationId: 'conv-1',
        assistantMessageId: 'asst-cancel',
        messages: [{ role: 'user', content: 'Stream slowly' }]
      },
      {
        emit: (evt) => events.push(evt)
      }
    )

    // Wait for first delta
    await new Promise((resolve) => setTimeout(resolve, 50))

    const cancelResult = await kernel.cancel({ requestId: 'req-cancel' })
    expect(cancelResult.cancelled).toBe(true)

    // Wait for abort cycle to finalize
    await new Promise((resolve) => setTimeout(resolve, 80))

    const terminalEvents = events.filter((e) => ['chat.stream.completed', 'chat.stream.failed', 'chat.stream.cancelled'].includes(e.type))
    expect(terminalEvents.length).toBe(1)
    expect(terminalEvents[0].type).toBe('chat.stream.cancelled')

    const state = kernel.getState()
    const msg = state.messages.find((m) => m.id === 'asst-cancel')
    expect(msg?.status).toBe('cancelled')
    expect(msg?.content.length).toBeGreaterThan(0) // Retains partial text
  })

  it('should safely map model errors and allow subsequent retry', async () => {
    const fakeModel = new FakeChatModel()
    fakeModel.shouldFail = true
    fakeModel.failureError = Object.assign(new Error('Rate limited'), { status: 429 })

    const kernel = new ChatKernel(fakeModel)
    const events: ChatEvent[] = []

    await kernel.start(
      {
        requestId: 'req-fail',
        conversationId: 'conv-1',
        assistantMessageId: 'asst-fail',
        messages: [{ role: 'user', content: 'Will fail' }]
      },
      {
        emit: (evt) => events.push(evt)
      }
    )

    await new Promise((resolve) => setTimeout(resolve, 50))

    const failedEvent = events.find((e): e is Extract<ChatEvent, { type: 'chat.stream.failed' }> => e.type === 'chat.stream.failed')
    expect(failedEvent).toBeDefined()
    expect(failedEvent?.error.code).toBe('PROVIDER_RATE_LIMITED')
    expect(failedEvent?.error.retryable).toBe(true)

    // Verify subsequent retry is accepted
    fakeModel.shouldFail = false
    const retryResult = await kernel.start(
      {
        requestId: 'req-retry',
        conversationId: 'conv-1',
        assistantMessageId: 'asst-retry',
        messages: [{ role: 'user', content: 'Try again' }]
      },
      {
        emit: () => {}
      }
    )
    expect(retryResult.accepted).toBe(true)
  })

  it('should retain context for multi-turn conversation and pass full history to model', async () => {
    const fakeModel = new FakeChatModel()
    const kernel = new ChatKernel(fakeModel)

    // Turn 1
    await kernel.start(
      {
        requestId: 'turn-1',
        conversationId: 'conv-multiturn',
        assistantMessageId: 'asst-1',
        messages: [{ role: 'user', content: 'Turn 1 User' }]
      },
      { emit: () => {} }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Turn 2
    await kernel.start(
      {
        requestId: 'turn-2',
        conversationId: 'conv-multiturn',
        assistantMessageId: 'asst-2',
        messages: [
          { role: 'user', content: 'Turn 1 User' },
          { role: 'assistant', content: 'Hello world' },
          { role: 'user', content: 'Turn 2 User' }
        ]
      },
      { emit: () => {} }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fakeModel.receivedMessages.length).toBe(3)
    expect(fakeModel.receivedMessages[0].content).toBe('Turn 1 User')
    expect(fakeModel.receivedMessages[1].content).toBe('Hello world')
    expect(fakeModel.receivedMessages[2].content).toBe('Turn 2 User')
  })
})
