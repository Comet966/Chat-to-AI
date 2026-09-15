import { describe, expect, it, vi } from 'vitest'
import { ElectronTransport } from '../../apps/desktop/src/main/electron-transport.js'
import type { ChatKernel } from 'chat-core'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

describe('ElectronTransport', () => {
  const createMockKernel = () => {
    return {
      start: vi.fn().mockResolvedValue({ accepted: true, requestId: 'req-1' }),
      cancel: vi.fn().mockResolvedValue({ cancelled: true, requestId: 'req-1' })
    } as unknown as ChatKernel
  }

  const createMockEvent = (url: string) => {
    const webContents = {
      isDestroyed: () => false,
      send: vi.fn()
    } as unknown as WebContents

    return {
      sender: webContents,
      senderFrame: { url }
    } as unknown as IpcMainInvokeEvent
  }

  it('should accept start command from allowed origin and forward to kernel', async () => {
    const kernel = createMockKernel()
    const transport = new ElectronTransport({
      kernel,
      allowedOrigins: ['http://localhost:5173']
    })

    const event = createMockEvent('http://localhost:5173/index.html')
    const result = await transport.handleStartChat(event, {
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(result.accepted).toBe(true)
    expect(kernel.start).toHaveBeenCalledTimes(1)
  })

  it('should reject start command from unauthorized sender origin', async () => {
    const kernel = createMockKernel()
    const transport = new ElectronTransport({
      kernel,
      allowedOrigins: ['http://localhost:5173']
    })

    const event = createMockEvent('https://malicious-site.com')
    const result = await transport.handleStartChat(event, {
      requestId: 'req-unauth',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(result.accepted).toBe(false)
    if (!result.accepted) {
      expect(result.error.code).toBe('INVALID_REQUEST')
      expect(result.error.message).toContain('Unauthorized IPC sender origin')
    }
    expect(kernel.start).not.toHaveBeenCalled()
  })

  it('should reject malformed payload before calling kernel', async () => {
    const kernel = createMockKernel()
    const transport = new ElectronTransport({
      kernel,
      allowedOrigins: ['http://localhost:5173']
    })

    const event = createMockEvent('http://localhost:5173')
    const result = await transport.handleStartChat(event, {
      requestId: '', // Invalid empty requestId
      messages: []
    })

    expect(result.accepted).toBe(false)
    if (!result.accepted) {
      expect(result.error.code).toBe('INVALID_REQUEST')
      expect(result.error.message).toContain('Invalid command payload')
    }
    expect(kernel.start).not.toHaveBeenCalled()
  })

  it('should forward cancel command to kernel', async () => {
    const kernel = createMockKernel()
    const transport = new ElectronTransport({
      kernel,
      allowedOrigins: ['http://localhost:5173']
    })

    const event = createMockEvent('http://localhost:5173')
    const result = await transport.handleCancelChat(event, {
      requestId: 'req-1'
    })

    expect(result.cancelled).toBe(true)
    expect(kernel.cancel).toHaveBeenCalledWith({ requestId: 'req-1' })
  })
})
