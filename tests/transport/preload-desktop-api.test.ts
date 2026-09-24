import { describe, expect, it, vi } from 'vitest'
import { createDesktopBridge } from '../../apps/desktop/src/preload/desktop-api.js'
import { DESKTOP_IPC_CHANNELS } from '../../apps/desktop/src/shared/desktop-api.contract.js'

describe('Preload Desktop API Bridge', () => {
  it('should expose a narrow frozen API without ipcRenderer, require, or process', () => {
    const mockIpc = { invoke: vi.fn() }
    const bridge = createDesktopBridge(mockIpc)

    expect(bridge).toHaveProperty('app')
    expect(bridge.app).toHaveProperty('getInfo')
    expect(typeof bridge.app.getInfo).toBe('function')

    // Must NOT expose internal or dangerous properties
    expect(bridge).not.toHaveProperty('ipcRenderer')
    expect(bridge).not.toHaveProperty('send')
    expect(bridge).not.toHaveProperty('invoke')
    expect(bridge).not.toHaveProperty('require')
    expect(bridge).not.toHaveProperty('process')

    // Must be frozen
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(Object.isFrozen(bridge.app)).toBe(true)
  })

  it('should delegate getInfo to ipc invoke with correct channel', async () => {
    const mockInfo = {
      ok: true,
      value: {
        name: 'Chat to AI',
        version: '0.1.0',
        isPackaged: false,
        platform: 'darwin'
      }
    }
    const mockIpc = {
      invoke: vi.fn().mockResolvedValueOnce(mockInfo)
    }

    const bridge = createDesktopBridge(mockIpc)
    const result = await bridge.app.getInfo()

    expect(mockIpc.invoke).toHaveBeenCalledWith(DESKTOP_IPC_CHANNELS.APP_GET_INFO, {})
    expect(result).toEqual(mockInfo)
  })
})
