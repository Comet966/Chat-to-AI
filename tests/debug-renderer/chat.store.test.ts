import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../../apps/debug-renderer/src/store/chat.store.js'

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().resetConversation()
  })

  it('should initialize with default empty state', () => {
    const state = useChatStore.getState()
    expect(state.messages).toEqual([])
    expect(state.streamStatus).toBe('idle')
    expect(state.activeRequestId).toBeNull()
    expect(state.lastSequence).toBe(-1)
    expect(state.error).toBeNull()
  })

  it('should append messages correctly', () => {
    const store = useChatStore.getState()
    store.appendMessage({
      id: 'msg-1',
      conversationId: store.conversationId,
      parentId: null,
      role: 'user',
      content: 'Hello',
      status: 'complete',
      createdAt: new Date().toISOString()
    })

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello')
  })

  it('should append delta only when sequence > lastSequence', () => {
    const store = useChatStore.getState()
    store.appendMessage({
      id: 'asst-1',
      conversationId: store.conversationId,
      parentId: null,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString()
    })

    store.markStreamStarted('req-1')

    // Sequence 0: accepted
    useChatStore.getState().appendDelta('asst-1', 0, 'Hello')
    expect(useChatStore.getState().messages[0].content).toBe('Hello')
    expect(useChatStore.getState().lastSequence).toBe(0)

    // Sequence 0 again (duplicate): ignored
    useChatStore.getState().appendDelta('asst-1', 0, ' duplicate')
    expect(useChatStore.getState().messages[0].content).toBe('Hello')
    expect(useChatStore.getState().lastSequence).toBe(0)

    // Sequence 1: accepted
    useChatStore.getState().appendDelta('asst-1', 1, ' world')
    expect(useChatStore.getState().messages[0].content).toBe('Hello world')
    expect(useChatStore.getState().lastSequence).toBe(1)
  })

  it('should handle completed, cancelled, and failed transitions', () => {
    const store = useChatStore.getState()
    store.appendMessage({
      id: 'asst-1',
      conversationId: store.conversationId,
      parentId: null,
      role: 'assistant',
      content: 'Partial',
      status: 'streaming',
      createdAt: new Date().toISOString()
    })
    store.markStreamStarted('req-1')

    // Test cancelled
    store.markStreamCancelled('asst-1')
    expect(useChatStore.getState().streamStatus).toBe('cancelled')
    expect(useChatStore.getState().activeRequestId).toBeNull()
    expect(useChatStore.getState().messages[0].status).toBe('cancelled')
    expect(useChatStore.getState().messages[0].content).toBe('Partial') // Preserves partial

    // Test failed
    useChatStore.getState().markStreamFailed('asst-1', {
      code: 'PROVIDER_RATE_LIMITED',
      message: 'Rate limit',
      retryable: true
    })
    expect(useChatStore.getState().streamStatus).toBe('failed')
    expect(useChatStore.getState().error?.code).toBe('PROVIDER_RATE_LIMITED')

    // Test reset
    useChatStore.getState().resetConversation()
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().streamStatus).toBe('idle')
  })
})
