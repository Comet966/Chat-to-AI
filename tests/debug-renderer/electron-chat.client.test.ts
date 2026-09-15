import { describe, expect, it, vi } from 'vitest'
import { ElectronChatClient } from '../../apps/debug-renderer/src/clients/electron-chat.client.js'
import type { ElectronChatBridgeApi } from 'chat-contracts'

describe('ElectronChatClient', () => {
  it('should return safe error when bridge is not available', async () => {
    const client = new ElectronChatClient(undefined)

    const startResult = await client.start({
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(startResult.accepted).toBe(false)
    if (!startResult.accepted) {
      expect(startResult.error.code).toBe('PROVIDER_UNAVAILABLE')
    }

    const cancelResult = await client.cancel({ requestId: 'req-1' })
    expect(cancelResult.cancelled).toBe(false)

    const unsubscribe = client.subscribe(() => {})
    expect(typeof unsubscribe).toBe('function')
  })

  it('should delegate calls to bridge when provided', async () => {
    const mockBridge: ElectronChatBridgeApi = {
      start: vi.fn().mockResolvedValue({ accepted: true, requestId: 'req-1' }),
      cancel: vi.fn().mockResolvedValue({ cancelled: true, requestId: 'req-1' }),
      onEvent: vi.fn().mockReturnValue(() => {})
    }

    const client = new ElectronChatClient(mockBridge)

    const startResult = await client.start({
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(startResult.accepted).toBe(true)
    expect(mockBridge.start).toHaveBeenCalledTimes(1)

    const cancelResult = await client.cancel({ requestId: 'req-1' })
    expect(cancelResult.cancelled).toBe(true)
    expect(mockBridge.cancel).toHaveBeenCalledWith({ requestId: 'req-1' })

    const listener = vi.fn()
    const unsubscribe = client.subscribe(listener)
    expect(mockBridge.onEvent).toHaveBeenCalledWith(listener)
    expect(typeof unsubscribe).toBe('function')
  })
})
