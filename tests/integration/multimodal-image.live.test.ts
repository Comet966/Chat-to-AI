import { describe, expect, it } from 'vitest'
import { ChatKernel, ImageGenerationKernel } from 'chat-core'
import { createImageGenerationAdapter, createModelAdapter, resolveProviderConfig, type OpenAIImageEndpoint } from 'chat-model-adapters'
import type { ChatEvent } from 'chat-contracts'

// Explicit opt-in only: regular test runs never consume provider quota.
describe.skipIf(process.env.AI_RUN_MULTIMODAL_LIVE_TEST !== '1')('live multimodal kernel smoke test', () => {
  it('generates an image, then sends that image through the streaming chat kernel', async () => {
    const resolved = resolveProviderConfig()
    if (!resolved.success) throw new Error(resolved.error)
    const endpoint = process.env.AI_IMAGE_ENDPOINT as OpenAIImageEndpoint | undefined
    const imageKernel = new ImageGenerationKernel(createImageGenerationAdapter(resolved.config, { endpoint }))
    const generated = await imageKernel.generate({
      requestId: 'live-image', prompt: 'Generate an image of a solid blue square on a white background. No text.'
    }, AbortSignal.timeout(150000))
    if (!generated.success) throw new Error(`${generated.error.code}: ${generated.error.message}`)
    const image = generated.output.images[0]
    expect(image.type).toBe('base64')
    if (image.type !== 'base64') throw new Error('This smoke test expects inline image data; it does not download external URLs')
    const bytes = Buffer.from(image.data, 'base64')
    expect(bytes.length).toBeGreaterThan(64)
    const magic = bytes.subarray(0, 12).toString('hex')
    if (image.mediaType === 'image/jpeg') expect(magic.startsWith('ffd8ff')).toBe(true)
    else if (image.mediaType === 'image/png') expect(magic.startsWith('89504e470d0a1a0a')).toBe(true)
    else if (image.mediaType === 'image/webp') {
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
    } else expect(bytes.subarray(0, 3).toString()).toBe('GIF')

    const kernel = new ChatKernel(createModelAdapter(resolved.config))
    const events: ChatEvent[] = []
    let finish!: () => void
    const completed = new Promise<void>((resolve) => { finish = resolve })
    const timer = setTimeout(() => { void kernel.cancel({ requestId: 'live-vision' }) }, 150000)
    try {
      const started = await kernel.start({
        requestId: 'live-vision', conversationId: 'live-media', assistantMessageId: 'live-answer', messages: [{
          role: 'user', content: 'Describe the main color and shape in this image using one short sentence. Reply with text only; do not generate another image.',
          attachments: [{ type: 'image', mediaType: image.mediaType, source: { type: 'base64', data: image.data } }]
        }]
      }, { emit(event) {
        events.push(event)
        if (['chat.stream.completed', 'chat.stream.failed', 'chat.stream.cancelled'].includes(event.type)) finish()
      } })
      expect(started.accepted).toBe(true)
      if (!started.accepted) throw new Error(started.error.message)
      await completed
      expect(events.at(-1)?.type).toBe('chat.stream.completed')
      expect(events.some((event) => event.type === 'chat.stream.delta' && event.delta.trim())).toBe(true)
      expect(kernel.getState().messages.at(-1)?.content.trim()).not.toBe('')
      console.info(`Live kernel test passed: ${image.mediaType}, ${bytes.length} image bytes; ${events.filter((event) => event.type === 'chat.stream.delta').length} text deltas.`)
    } finally { clearTimeout(timer) }
  }, 320000)
})
