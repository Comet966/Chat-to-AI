import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { ProviderTransport } from '../../apps/desktop/src/main/provider/provider.transport.js'
import type { ProviderRuntimeService } from '../../apps/desktop/src/main/provider/provider-runtime.service.js'
import { SenderPolicy } from '../../apps/desktop/src/main/security/sender-policy.js'

function event(url: string, topLevel = true): IpcMainInvokeEvent {
  return {
    senderFrame: { url, parent: topLevel ? null : {} }
  } as unknown as IpcMainInvokeEvent
}

describe('ProviderTransport', () => {
  it('rejects unauthorized senders before provider access', async () => {
    const service = { getSettings: vi.fn() } as unknown as ProviderRuntimeService
    const transport = new ProviderTransport(
      service,
      new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] })
    )
    const result = await transport.handleGetSettings(event('https://evil.example'), {})
    expect(result.ok).toBe(false)
    expect(service.getSettings).not.toHaveBeenCalled()
  })

  it('rejects unknown fields in provider settings', async () => {
    const service = { saveSettings: vi.fn() } as unknown as ProviderRuntimeService
    const transport = new ProviderTransport(
      service,
      new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] })
    )
    const result = await transport.handleSaveSettings(event('http://localhost:5173'), {
      provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key', modelId: 'model', maxOutputTokens: 10, unexpected: true
    })
    expect(result.ok).toBe(false)
    expect(service.saveSettings).not.toHaveBeenCalled()
  })

  it('registers and removes five provider handlers', () => {
    const service = {} as ProviderRuntimeService
    const ipc = { handle: vi.fn(), removeHandler: vi.fn() }
    const transport = new ProviderTransport(
      service,
      new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] }),
      ipc
    )
    const unregister = transport.register()
    expect(ipc.handle).toHaveBeenCalledTimes(5)
    unregister()
    expect(ipc.removeHandler).toHaveBeenCalledTimes(5)
  })
})
