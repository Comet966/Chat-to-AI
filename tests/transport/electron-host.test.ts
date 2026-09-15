import { describe, expect, it, vi } from 'vitest'
import { ElectronHost } from '../../apps/desktop/src/main/electron-host.js'

describe('ElectronHost', () => {
  it('cancels the active kernel request before unregistering the transport', async () => {
    const host = new ElectronHost()
    const cancel = vi.fn().mockResolvedValue({ requestId: 'req-1', cancelled: true })
    const unregisterTransport = vi.fn()

    Object.assign(host as unknown as Record<string, unknown>, {
      kernel: {
        getState: () => ({ activeRequestId: 'req-1' }),
        cancel
      },
      unregisterTransport
    })

    await host.shutdown()

    expect(cancel).toHaveBeenCalledWith({ requestId: 'req-1' })
    expect(unregisterTransport).toHaveBeenCalledOnce()
  })
})
