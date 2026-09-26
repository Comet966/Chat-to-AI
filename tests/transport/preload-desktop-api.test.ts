import { describe, expect, it, vi } from 'vitest'
import { createDesktopBridge } from '../../apps/desktop/src/preload/desktop-api.js'
import { DESKTOP_IPC_CHANNELS } from '../../apps/desktop/src/shared/desktop-api.contract.js'

describe('Preload Desktop API Bridge', () => {
  it('should expose a narrow frozen API without ipcRenderer, require, or process', () => {
    const mockIpc = { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
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
    expect(Object.isFrozen(bridge.conversation)).toBe(true)
    expect(Object.isFrozen(bridge.provider)).toBe(true)
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
      invoke: vi.fn().mockResolvedValueOnce(mockInfo),
      on: vi.fn(),
      removeListener: vi.fn()
    }

    const bridge = createDesktopBridge(mockIpc)
    const result = await bridge.app.getInfo()

    expect(mockIpc.invoke).toHaveBeenCalledWith(DESKTOP_IPC_CHANNELS.APP_GET_INFO, {})
    expect(result).toEqual(mockInfo)
  })

  it('validates conversation responses and removes only its own event listener', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => void>()
    const mockIpc = {
      invoke: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          treeId: 'tree-1', revision: 0, rootTurnId: null, currentTurnId: null, turns: []
        }
      }),
      on: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => void) => {
        handlers.set(channel, handler)
      }),
      removeListener: vi.fn()
    }
    const bridge = createDesktopBridge(mockIpc)
    const snapshot = await bridge.conversation.getSnapshot()
    expect(snapshot.ok).toBe(true)

    const listener = vi.fn()
    const unsubscribe = bridge.conversation.onEvent(listener)
    const handler = handlers.get(DESKTOP_IPC_CHANNELS.CONVERSATION_EVENT)!
    handler({}, { type: 'invalid-event' })
    expect(listener).not.toHaveBeenCalled()
    handler({}, {
      type: 'conversation.turn.delta', schemaVersion: 1, treeId: 'tree-1',
      requestId: 'request-1', sequence: 0, delta: 'hello'
    })
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledWith(
      DESKTOP_IPC_CHANNELS.CONVERSATION_EVENT,
      handler
    )
  })
})
