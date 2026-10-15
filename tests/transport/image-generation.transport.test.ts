import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { ImageGenerationTransport } from '../../apps/desktop/src/main/image-generation/image-generation.transport.js'
import type { DesktopImageGenerationService } from '../../apps/desktop/src/main/image-generation/desktop-image-generation.service.js'
import { SenderPolicy } from '../../apps/desktop/src/main/security/sender-policy.js'
import { createDesktopBridge } from '../../apps/desktop/src/preload/desktop-api.js'

const input = { requestId: 'img', prompt: 'Blue square', modelId: 'image-model', endpoint: 'chat-completions' }
const event = (url = 'http://localhost:5173', nested = false) => ({
  sender: { isDestroyed: () => false }, senderFrame: { url, parent: nested ? {} : null }
}) as unknown as IpcMainInvokeEvent

function setup() {
  const service = { generate: vi.fn(), cancel: vi.fn(), save: vi.fn(), dispose: vi.fn() }
  const ipc = { handle: vi.fn(), removeHandler: vi.fn() }
  const transport = new ImageGenerationTransport(service as unknown as DesktopImageGenerationService,
    new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] }), ipc)
  return { service, ipc, transport }
}

describe('image generation IPC isolation', () => {
  it('rejects external or nested-frame callers before any service access', async () => {
    const { service, transport } = setup()
    for (const caller of [event('https://evil.example'), event(undefined, true)]) {
      expect(await transport.handleGenerate(caller, input)).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED_SENDER' } })
      expect(await transport.handleSave(caller, { requestId: 'img', imageIndex: 0 })).toMatchObject({ ok: false })
      expect(transport.handleCancel(caller, { requestId: 'img' })).toMatchObject({ ok: false })
    }
    expect(service.generate).not.toHaveBeenCalled()
    expect(service.save).not.toHaveBeenCalled()
    expect(service.cancel).not.toHaveBeenCalled()
  })

  it('rejects credentials, arbitrary save paths, invalid indexes, and unknown fields', async () => {
    const { service, transport } = setup()
    expect(await transport.handleGenerate(event(), { ...input, apiKey: 'secret' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(await transport.handleSave(event(), { requestId: 'img', imageIndex: 0, path: '/private/anywhere' })).toMatchObject({ ok: false })
    expect(await transport.handleSave(event(), { requestId: 'img', imageIndex: -1 })).toMatchObject({ ok: false })
    expect(service.generate).not.toHaveBeenCalled()
    expect(service.save).not.toHaveBeenCalled()
  })

  it('routes narrow validated requests and disposes registered handlers', async () => {
    const { service, ipc, transport } = setup()
    const unregister = transport.register()
    expect(ipc.handle).toHaveBeenCalledTimes(3)
    await transport.handleGenerate(event(), input)
    expect(service.generate).toHaveBeenCalledWith(input)
    transport.handleCancel(event(), { requestId: 'img' })
    expect(service.cancel).toHaveBeenCalledWith('img')
    await transport.handleSave(event(), { requestId: 'img', imageIndex: 0 })
    expect(service.save).toHaveBeenCalledWith('img', 0)
    unregister()
    expect(ipc.removeHandler).toHaveBeenCalledTimes(3)
    expect(service.dispose).toHaveBeenCalledOnce()
  })

  it('validates bridge results and rejects malformed or executable image data', async () => {
    const ipc = { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
    const bridge = createDesktopBridge(ipc)
    expect(Object.isFrozen(bridge.imageGeneration)).toBe(true)
    const valid = { ok: true, value: { requestId: 'img', modelId: 'image-model', output: {
      images: [{ type: 'base64', mediaType: 'image/png', data: 'aGVsbG8=' }]
    } } }
    ipc.invoke.mockResolvedValue(valid)
    expect(await bridge.imageGeneration.generate(input as Parameters<typeof bridge.imageGeneration.generate>[0])).toEqual(valid)
    expect(ipc.invoke).toHaveBeenCalledWith('desktop:image:generate', input)
    for (const images of [
      [], [{ type: 'base64', mediaType: 'image/svg+xml', data: 'aGVsbG8=' }], [{ type: 'url', url: 'javascript:alert(1)' }]
    ]) {
      ipc.invoke.mockResolvedValue({ ...valid, value: { ...valid.value, output: { images } } })
      expect(await bridge.imageGeneration.generate(input as Parameters<typeof bridge.imageGeneration.generate>[0])).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
    }
    ipc.invoke.mockResolvedValue({ ok: true, value: { requestId: 'img', apiKey: 'secret', modelId: 'image-model', output: valid.value.output } })
    expect(await bridge.imageGeneration.generate(input as Parameters<typeof bridge.imageGeneration.generate>[0])).toMatchObject({ ok: false })
  })
})
