import { describe, expect, it, vi } from 'vitest'
import { ImageGenerationKernel, type ImageGenerationModelPort } from 'chat-core'
import type { ImageGenerationOutput } from 'chat-contracts'

const output: ImageGenerationOutput = { images: [{ type: 'base64', mediaType: 'image/png', data: 'aGVsbG8=' }] }
const command = { requestId: 'img', prompt: 'A blue square' }
const model = (generateImage = vi.fn<ImageGenerationModelPort['generateImage']>().mockResolvedValue(output)): ImageGenerationModelPort => ({ modelId: 'image-model', generateImage })

describe('ImageGenerationKernel', () => {
  it('returns structured output without altering a conversation or exposing configuration', async () => {
    const port = model()
    const result = await new ImageGenerationKernel(port).generate(command)
    expect(result).toEqual({ requestId: 'img', success: true, modelId: 'image-model', output })
    expect(port.generateImage).toHaveBeenCalledWith({ prompt: 'A blue square' }, expect.any(AbortSignal))
  })

  it('validates input and provider output', async () => {
    const port = model()
    const kernel = new ImageGenerationKernel(port)
    expect(await kernel.generate({ ...command, prompt: ' ' })).toMatchObject({ success: false, error: { code: 'INVALID_REQUEST' } })
    expect(port.generateImage).not.toHaveBeenCalled()
    for (const bad of [{ images: [] }, { images: [{ type: 'url', url: 'javascript:alert(1)' }] }, { images: [{ type: 'base64', mediaType: 'text/html', data: 'xxx' }] }]) {
      const invalid = model(vi.fn().mockResolvedValue(bad))
      expect(await new ImageGenerationKernel(invalid).generate(command)).toMatchObject({ success: false, error: { code: 'INVALID_RESPONSE' } })
    }
  })

  it('enforces one active request and rejects late results after cancellation', async () => {
    let complete!: (value: ImageGenerationOutput) => void
    const port = model(vi.fn().mockImplementation(() => new Promise<ImageGenerationOutput>((resolve) => { complete = resolve })))
    const kernel = new ImageGenerationKernel(port)
    const first = kernel.generate(command)
    expect(await kernel.generate({ ...command, requestId: 'second' })).toMatchObject({ success: false, error: { code: 'REQUEST_IN_PROGRESS' } })
    expect(kernel.cancel('unknown')).toBe(false)
    expect(kernel.cancel('img')).toBe(true)
    expect(kernel.cancel('img')).toBe(false)
    complete(output)
    expect(await first).toMatchObject({ success: false, error: { code: 'REQUEST_ABORTED' } })
    const next = kernel.generate({ ...command, requestId: 'next' })
    complete(output)
    expect(await next).toMatchObject({ success: true })
    expect(kernel.cancel('next')).toBe(false)
  })

  it('honors caller cancellation before dispatch and during generation', async () => {
    const port = model()
    expect(await new ImageGenerationKernel(port).generate(command, AbortSignal.abort())).toMatchObject({ success: false, error: { code: 'REQUEST_ABORTED' } })
    expect(port.generateImage).not.toHaveBeenCalled()
    const active = model(vi.fn().mockImplementation((_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    })))
    const controller = new AbortController()
    const pending = new ImageGenerationKernel(active).generate(command, controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ success: false, error: { code: 'REQUEST_ABORTED' } })
  })

  it.each([[401, 'PROVIDER_UNAUTHORIZED'], [429, 'PROVIDER_RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE'], [400, 'INVALID_REQUEST']])('maps HTTP %s without leaking a key', async (status, code) => {
    const port = model(vi.fn().mockRejectedValue(Object.assign(new Error('api-key-secret'), { status })))
    const result = await new ImageGenerationKernel(port).generate(command)
    expect(result).toMatchObject({ success: false, error: { code } })
    expect(JSON.stringify(result)).not.toContain('api-key-secret')
  })
})
