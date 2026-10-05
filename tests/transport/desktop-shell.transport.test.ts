import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  DesktopShellTransport
} from '../../apps/desktop/src/main/desktop-shell.transport.js'
import { SenderPolicy } from '../../apps/desktop/src/main/security/sender-policy.js'

describe('DesktopShellTransport', () => {
  const createMockEvent = (url: string, isTopLevel = true): IpcMainInvokeEvent => {
    return {
      senderFrame: {
        url,
        parent: isTopLevel ? null : ({} as any)
      }
    } as unknown as IpcMainInvokeEvent
  }

  it('should accept get-info from allowed origin and top-level frame', async () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['http://localhost:5173']
    })
    const transport = new DesktopShellTransport({ senderPolicy })

    const event = createMockEvent('http://localhost:5173/index.html', true)
    const result = await transport.handleGetInfo(event, {})

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveProperty('name')
      expect(result.value).toHaveProperty('version')
      expect(result.value).toHaveProperty('platform')
    }
  })

  it('should reject get-info from unauthorized origin', async () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['http://localhost:5173']
    })
    const transport = new DesktopShellTransport({ senderPolicy })

    const event = createMockEvent('https://malicious.com', true)
    const result = await transport.handleGetInfo(event, {})

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED_SENDER')
    }
  })

  it('should reject a different local file even when the renderer file is allowed', async () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['file:///opt/chat-to-ai/renderer/index.html']
    })
    const transport = new DesktopShellTransport({ senderPolicy })

    const event = createMockEvent('file:///tmp/untrusted.html', true)
    const result = await transport.handleGetInfo(event, {})

    expect(result.ok).toBe(false)
  })

  it('should accept the configured local renderer file with a hash route', async () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['file:///opt/chat-to-ai/renderer/index.html']
    })
    const transport = new DesktopShellTransport({ senderPolicy })

    const event = createMockEvent(
      'file:///opt/chat-to-ai/renderer/index.html#/settings/providers',
      true
    )
    const result = await transport.handleGetInfo(event, {})

    expect(result.ok).toBe(true)
  })

  it('should reject get-info from nested iframe even on allowed origin', async () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['http://localhost:5173']
    })
    const transport = new DesktopShellTransport({ senderPolicy })

    const event = createMockEvent('http://localhost:5173/nested.html', false)
    const result = await transport.handleGetInfo(event, {})

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED_SENDER')
    }
  })

  it('should reject invalid payload with VALIDATION_FAILED', async () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['http://localhost:5173']
    })
    const transport = new DesktopShellTransport({ senderPolicy })

    const event = createMockEvent('http://localhost:5173/index.html', true)
    const result = await transport.handleGetInfo(event, 'invalid-payload-string')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('should unregister handler cleanly when register is called', () => {
    const senderPolicy = new SenderPolicy({
      allowedOrigins: ['http://localhost:5173']
    })
    const mockIpc = {
      handle: vi.fn(),
      removeHandler: vi.fn()
    }
    const transport = new DesktopShellTransport({ senderPolicy, ipc: mockIpc })

    const unregister = transport.register()

    unregister()
    expect(mockIpc.handle).toHaveBeenCalledWith('desktop:app:get-info', expect.any(Function))
    expect(mockIpc.removeHandler).toHaveBeenCalledWith('desktop:app:get-info')
  })
})
