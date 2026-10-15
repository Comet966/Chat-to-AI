import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { resolveProviderConfig, type OpenAIImageEndpoint } from 'chat-model-adapters'
import { DesktopImageGenerationService } from '../../apps/desktop/src/main/image-generation/desktop-image-generation.service.js'
import { ImageGenerationTransport } from '../../apps/desktop/src/main/image-generation/image-generation.transport.js'
import { SenderPolicy } from '../../apps/desktop/src/main/security/sender-policy.js'
import { createDesktopBridge } from '../../apps/desktop/src/preload/desktop-api.js'
import { ElectronImageGenerationAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-image-generation.adapter.js'
import { DESKTOP_IPC_CHANNELS } from '../../apps/desktop/src/shared/desktop-api.contract.js'

// Opt-in: normal test runs never consume image-generation quota.
describe.skipIf(process.env.AI_RUN_DESKTOP_IMAGE_LIVE_TEST !== '1')('desktop image-generation live bridge', () => {
  it('passes a real image through main service, IPC handlers, preload validation and UI adapter', async () => {
    const resolved = resolveProviderConfig()
    if (!resolved.success) throw new Error(resolved.error)
    const saved: Buffer[] = []
    const service = new DesktopImageGenerationService({
      getProviderConfig: () => resolved.config,
      saveImage: async (image) => { saved.push(Buffer.from(image.data, 'base64')); return true }
    })
    const caller = {
      sender: { isDestroyed: () => false },
      senderFrame: { url: 'http://localhost:5173/', parent: null }
    } as unknown as IpcMainInvokeEvent
    const transport = new ImageGenerationTransport(service,
      new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] }))
    const bridge = createDesktopBridge({
      invoke: async (channel, payload) => {
        if (channel === DESKTOP_IPC_CHANNELS.IMAGE_GENERATE) return transport.handleGenerate(caller, payload)
        if (channel === DESKTOP_IPC_CHANNELS.IMAGE_SAVE) return transport.handleSave(caller, payload)
        if (channel === DESKTOP_IPC_CHANNELS.IMAGE_CANCEL) return transport.handleCancel(caller, payload)
        throw new Error('Unexpected IPC channel')
      },
      on: vi.fn(), removeListener: vi.fn()
    })
    const port = new ElectronImageGenerationAdapter(bridge.imageGeneration)
    try {
      const generated = await port.generate({
        requestId: 'desktop-live-image', modelId: resolved.config.modelId,
        prompt: 'Generate a simple image of a blue square on a white background. No text.',
        ...(resolved.config.provider === 'openai-compatible'
          ? { endpoint: process.env.AI_IMAGE_ENDPOINT as OpenAIImageEndpoint | undefined } : {})
      })
      if (!generated.ok) throw new Error(`${generated.error.code}: ${generated.error.message}`)
      const image = generated.value.output.images[0]
      if (image.type !== 'base64') throw new Error('This live test expects inline images; remote URLs are not fetched')
      const bytes = Buffer.from(image.data, 'base64')
      expect(bytes.length).toBeGreaterThan(64)
      if (image.mediaType === 'image/jpeg') expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff')
      else if (image.mediaType === 'image/png') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      else if (image.mediaType === 'image/webp') {
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
        expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
      } else expect(bytes.subarray(0, 3).toString()).toBe('GIF')
      expect(await port.save({ requestId: generated.value.requestId, imageIndex: 0 })).toEqual({ ok: true, value: { saved: true } })
      expect(saved[0].equals(bytes)).toBe(true)
      expect(service.hasActiveRequest()).toBe(false)
      console.info(`Desktop live bridge passed: ${image.mediaType}, ${bytes.length} bytes; save callback received identical bytes.`)
    } finally { service.dispose() }
  }, 200000)
})
