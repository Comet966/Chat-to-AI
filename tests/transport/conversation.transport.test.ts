import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { ConversationTransport } from '../../apps/desktop/src/main/conversation/conversation.transport.js'
import type { DesktopConversationService } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'
import { SenderPolicy } from '../../apps/desktop/src/main/security/sender-policy.js'

function createEvent(url = 'http://localhost:5173/index.html', topLevel = true) {
  const sender = {
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  } as unknown as WebContents
  const event = {
    sender,
    senderFrame: { url, parent: topLevel ? null : {} }
  } as unknown as IpcMainInvokeEvent
  return { event, sender }
}

function createTransport() {
  const service = {
    getSnapshot: vi.fn().mockResolvedValue({
      ok: true,
      value: { treeId: 'tree-1', revision: 0, rootTurnId: null, currentTurnId: null, turns: [] }
    }),
    setCurrentTurn: vi.fn(),
    startTurn: vi.fn(async (_input, sink) => {
      sink.emit({
        type: 'conversation.turn.delta', schemaVersion: 1, treeId: 'tree-1',
        requestId: 'request-1', sequence: 0, delta: 'chunk'
      })
      return { ok: true, value: { requestId: 'request-1' } }
    }),
    cancelTurn: vi.fn().mockResolvedValue({ ok: true, value: undefined })
  } as unknown as DesktopConversationService
  return {
    service,
    transport: new ConversationTransport({
      service,
      senderPolicy: new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] })
    })
  }
}

describe('ConversationTransport', () => {
  it('rejects unauthorized and nested-frame senders', async () => {
    const { service, transport } = createTransport()
    const malicious = createEvent('https://malicious.example')
    const nested = createEvent('http://localhost:5173/index.html', false)

    expect((await transport.handleGetSnapshot(malicious.event, {})).ok).toBe(false)
    expect((await transport.handleGetSnapshot(nested.event, {})).ok).toBe(false)
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('rejects malformed turn input before calling the service', async () => {
    const { service, transport } = createTransport()
    const { event } = createEvent()
    const result = await transport.handleStartTurn(event, {
      prompt: '', expectedRevision: -1, currentTurnId: null,
      contextSelection: { mode: 'root-path', turnIds: [] }, extra: true
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(service.startTurn).not.toHaveBeenCalled()
  })

  it('forwards only validated events to the requesting webContents', async () => {
    const { transport } = createTransport()
    const { event, sender } = createEvent()
    const result = await transport.handleStartTurn(event, {
      prompt: 'hello', expectedRevision: 0, currentTurnId: null,
      contextSelection: { mode: 'root-path', turnIds: [] }
    })
    expect(result.ok).toBe(true)
    expect(sender.send).toHaveBeenCalledWith(
      'desktop:conversation:event',
      expect.objectContaining({ type: 'conversation.turn.delta', delta: 'chunk' })
    )
  })

  it('registers and removes each allow-listed handler', () => {
    const service = createTransport().service
    const ipc = { handle: vi.fn(), removeHandler: vi.fn() }
    const transport = new ConversationTransport({
      service,
      senderPolicy: new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] }),
      ipc
    })
    const unregister = transport.register()
    expect(ipc.handle).toHaveBeenCalledTimes(4)
    unregister()
    expect(ipc.removeHandler).toHaveBeenCalledTimes(4)
    expect(service.cancelTurn).toHaveBeenCalledOnce()
  })
})
