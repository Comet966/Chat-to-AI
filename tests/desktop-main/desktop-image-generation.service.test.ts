import { describe, expect, it, vi } from 'vitest'
import type { ImageGenerationOutput } from 'chat-contracts'
import { DesktopImageGenerationService } from '../../apps/desktop/src/main/image-generation/desktop-image-generation.service.js'
import { ProviderRuntimeService } from '../../apps/desktop/src/main/provider/provider-runtime.service.js'
import { MutableConversationModelProvider } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'

const output: ImageGenerationOutput = { images: [{ type: 'base64', mediaType: 'image/png', data: 'aGVsbG8=' }] }
const config = { provider: 'openai-compatible' as const, baseUrl: 'https://example.com/v1', apiKey: 'private-key', modelId: 'chat-model', maxOutputTokens: 1024 }
const input = { requestId: 'img-1', prompt: 'Blue square', modelId: 'image-model', endpoint: 'chat-completions' as const }

function setup(generateImage = vi.fn().mockResolvedValue(output)) {
  const createAdapter = vi.fn().mockImplementation((config) => ({ modelId: config.modelId, generateImage }))
  const saveImage = vi.fn().mockResolvedValue(true)
  const getProviderConfig = vi.fn().mockReturnValue(config)
  const service = new DesktopImageGenerationService({ createAdapter, saveImage, getProviderConfig })
  return { service, createAdapter, saveImage, getProviderConfig, generateImage }
}

describe('DesktopImageGenerationService', () => {
  it('uses a private provider snapshot with an independent image model', async () => {
    const { service, createAdapter } = setup()
    const result = await service.generate(input)
    expect(result).toMatchObject({ ok: true, value: { requestId: 'img-1', modelId: 'image-model', output } })
    expect(createAdapter).toHaveBeenCalledWith({ ...config, modelId: 'image-model' }, { endpoint: 'chat-completions' })
    expect(config.modelId).toBe('chat-model')
    expect(JSON.stringify(result)).not.toContain('private-key')
  })

  it('rejects invalid or unconfigured requests before dispatch', async () => {
    const { service, createAdapter, getProviderConfig } = setup()
    expect(await service.generate({ ...input, prompt: ' ' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    getProviderConfig.mockReturnValue(null)
    expect(await service.generate(input)).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } })
    expect(createAdapter).not.toHaveBeenCalled()
  })

  it('limits active requests, checks cancellation identity, and suppresses late results', async () => {
    let complete!: (output: ImageGenerationOutput) => void
    const { service } = setup(vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve })))
    const pending = service.generate(input)
    expect(service.hasActiveRequest()).toBe(true)
    expect(await service.generate({ ...input, requestId: 'second' })).toMatchObject({ ok: false, error: { code: 'REQUEST_IN_PROGRESS' } })
    expect(service.cancel('other')).toEqual({ ok: true, value: { cancelled: false } })
    expect(service.cancel('img-1')).toEqual({ ok: true, value: { cancelled: true } })
    complete(output)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(service.hasActiveRequest()).toBe(false)
  })

  it('saves Main-owned bytes by result ID and discards stale result IDs', async () => {
    const { service, saveImage } = setup()
    const result = await service.generate(input)
    if (!result.ok) throw new Error(result.error.message)
    result.value.output.images[0] = { type: 'url', url: 'https://attacker.example' }
    expect(await service.save('img-1', 0)).toEqual({ ok: true, value: { saved: true } })
    expect(saveImage).toHaveBeenCalledWith(output.images[0], 0)
    expect(await service.save('img-1', 2)).toMatchObject({ ok: false, error: { code: 'RESULT_NOT_FOUND' } })
    await service.generate({ ...input, requestId: 'img-2' })
    expect(await service.save('img-1', 0)).toMatchObject({ ok: false, error: { code: 'RESULT_NOT_FOUND' } })
    saveImage.mockResolvedValue(false)
    expect(await service.save('img-2', 0)).toEqual({ ok: true, value: { saved: false } })
  })

  it('never downloads provider-returned URLs or exposes save error details', async () => {
    const { service, saveImage, generateImage } = setup()
    generateImage.mockResolvedValue({ images: [{ type: 'url', url: 'https://example.com/image.png' }] })
    await service.generate(input)
    expect(await service.save('img-1', 0)).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_CAPABILITY' } })
    expect(saveImage).not.toHaveBeenCalled()
    generateImage.mockResolvedValue(output)
    await service.generate(input)
    saveImage.mockRejectedValue(new Error('/private/path/private-key'))
    const error = await service.save('img-1', 0)
    expect(error).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } })
    expect(JSON.stringify(error)).not.toContain('private-key')
  })

  it('blocks provider reconfiguration and key clearing during image generation', async () => {
    const modelProvider = new MutableConversationModelProvider()
    let service!: DesktopImageGenerationService
    const provider = new ProviderRuntimeService({ modelProvider, initialConfig: config, hasActiveTurn: () => service.hasActiveRequest() })
    let complete!: (output: ImageGenerationOutput) => void
    service = new DesktopImageGenerationService({
      getProviderConfig: () => provider.getRuntimeConfig(),
      createAdapter: () => ({ modelId: 'image-model', generateImage: () => new Promise((resolve) => { complete = resolve }) })
    })
    const pending = service.generate(input)
    expect(provider.clearKey()).toMatchObject({ ok: false, error: { code: 'TURN_IN_PROGRESS' } })
    expect(provider.saveSettings({ ...config, modelId: 'other' })).toMatchObject({ ok: false, error: { code: 'TURN_IN_PROGRESS' } })
    complete(output)
    await pending
    expect(provider.getSettings()).toMatchObject({ ok: true, value: { modelId: 'chat-model', apiKey: '' } })
    expect(provider.clearKey().ok).toBe(true)
  })

  it('cancels on disposal, releases result memory, and rejects new requests', async () => {
    let complete!: (output: ImageGenerationOutput) => void
    const { service } = setup(vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve })))
    const pending = service.generate(input)
    service.dispose()
    complete(output)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(await service.generate(input)).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
