import { describe, expect, it } from 'vitest'
import { ChatKernel, type ChatModelPort } from 'chat-core'
import type { ChatMessageInput, ChatEvent } from 'chat-contracts'

describe('ChatKernel multimodal input', () => {
  it('passes immutable media context to the model and preserves it in state', async () => {
    let received: ReadonlyArray<ChatMessageInput> = []
    const model: ChatModelPort = {
      modelId: 'vision-model',
      async *streamChat(input) {
        received = input.messages
        yield { type: 'text-delta', text: 'An image.' }
        yield { type: 'finish', finishReason: 'stop' }
      }
    }
    const kernel = new ChatKernel(model)
    const messages: ChatMessageInput[] = [{ role: 'user', content: '', attachments: [
      { type: 'image', mediaType: 'image/png', source: { type: 'base64', data: 'aGVsbG8=' } }
    ] }]
    let resolve!: () => void
    const done = new Promise<void>((accept) => { resolve = accept })
    const events: ChatEvent[] = []
    const result = await kernel.start({ requestId: 'req', conversationId: 'conv', assistantMessageId: 'asst', messages }, {
      emit(event) { events.push(event); if (event.type === 'chat.stream.completed') resolve() }
    })
    messages[0].content = 'Mutated by caller'
    messages[0].attachments![0].mediaType = 'image/jpeg'
    await done
    expect(result.accepted).toBe(true)
    expect(received[0].content).toBe('')
    expect(received[0].attachments![0].mediaType).toBe('image/png')
    const state = kernel.getState()
    expect(state.messages[0].attachments).toEqual(received[0].attachments)
    state.messages[0].attachments![0].mediaType = 'image/webp'
    expect(kernel.getState().messages[0].attachments![0].mediaType).toBe('image/png')
    expect(state.messages[1].content).toBe('An image.')
    expect(events.map((event) => event.type)).toEqual(['chat.stream.started', 'chat.stream.delta', 'chat.stream.completed'])
  })

  it('rejects invalid attachments before executing the model', async () => {
    let executed = false
    const kernel = new ChatKernel({ modelId: 'model', async *streamChat() { executed = true; yield { type: 'finish', finishReason: 'stop' } } })
    const result = await kernel.start({ requestId: 'req', conversationId: 'conv', assistantMessageId: 'asst', messages: [
      { role: 'user', content: 'hi', attachments: [{ type: 'image', mediaType: 'image/png', source: { type: 'url', url: 'file:///secret' } }] }
    ] }, { emit() {} })
    expect(result).toMatchObject({ accepted: false, error: { code: 'INVALID_REQUEST' } })
    expect(executed).toBe(false)
    expect(kernel.getState().messages).toEqual([])
  })

  it('maps unsupported media to a non-retryable public error', async () => {
    const kernel = new ChatKernel({ modelId: 'text-only', async *streamChat() {
      throw Object.assign(new Error('secret-provider-body'), { code: 'UNSUPPORTED_CAPABILITY' })
    } })
    let resolve!: (event: ChatEvent) => void
    const done = new Promise<ChatEvent>((accept) => { resolve = accept })
    await kernel.start({ requestId: 'req', conversationId: 'conv', assistantMessageId: 'asst', messages: [{ role: 'user', content: 'hi' }] }, {
      emit(event) { if (event.type === 'chat.stream.failed') resolve(event) }
    })
    expect(await done).toMatchObject({ type: 'chat.stream.failed', error: { code: 'UNSUPPORTED_CAPABILITY', retryable: false } })
    expect(JSON.stringify(await done)).not.toContain('secret-provider-body')
  })
})
