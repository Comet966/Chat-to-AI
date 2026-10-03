// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../apps/desktop/src/shared/desktop-api.contract.js'
import type {
  ConversationSnapshotDto,
  DesktopConversationEvent
} from '../../apps/desktop/src/shared/conversation.contract.js'
import { ElectronChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-chat-ui.adapter.js'
import { ElectronConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-conversation-tree-ui.adapter.js'

function createConversationApi(initialSnapshot: ConversationSnapshotDto) {
  const listeners = new Set<(event: DesktopConversationEvent) => void>()
  const api: DesktopApi['conversation'] = {
    getSnapshot: vi.fn().mockResolvedValue({ ok: true, value: initialSnapshot }),
    setCurrentTurn: vi.fn().mockImplementation(async ({ turnId }) => ({
      ok: true,
      value: { ...initialSnapshot, currentTurnId: turnId }
    })),
    startTurn: vi.fn().mockImplementation(async () => {
      const started: DesktopConversationEvent = {
        type: 'conversation.turn.started', schemaVersion: 1,
        requestId: 'request-1', treeId: initialSnapshot.treeId
      }
      for (const listener of listeners) listener(started)
      return { ok: true, value: { requestId: 'request-1' } }
    }),
    cancelTurn: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    onEvent: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
  }
  return {
    api,
    emit(event: DesktopConversationEvent) {
      for (const listener of listeners) listener(event)
    }
  }
}

const emptySnapshot: ConversationSnapshotDto = {
  treeId: 'tree-1', revision: 0, rootTurnId: null, currentTurnId: null, turns: []
}

describe('Electron renderer conversation adapters', () => {
  it('appends streaming deltas to one pending assistant and replaces it from completed snapshot', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    await Promise.resolve()

    const sent = await adapter.sendMessage({
      content: 'Question', expectedRevision: 0, currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })
    expect(sent.ok).toBe(true)
    bridge.emit({
      type: 'conversation.turn.delta', schemaVersion: 1, treeId: 'tree-1',
      requestId: 'request-1', sequence: 0, delta: 'Part 1'
    })
    bridge.emit({
      type: 'conversation.turn.delta', schemaVersion: 1, treeId: 'tree-1',
      requestId: 'request-1', sequence: 1, delta: ' Part 2'
    })
    expect(adapter.getState().messages.at(-1)?.content).toBe('Part 1 Part 2')

    bridge.emit({
      type: 'conversation.snapshot.changed', schemaVersion: 1, treeId: 'tree-1',
      snapshot: {
        treeId: 'tree-1', revision: 2, rootTurnId: 'a1', currentTurnId: 'a1',
        turns: [{
          id: 'a1', parentId: null, question: 'Question', answer: 'Part 1 Part 2',
          sequence: 0, createdAt: '2026-01-01T00:00:00.000Z'
        }]
      }
    })
    expect(adapter.getState()).toMatchObject({
      status: 'idle',
      messages: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Part 1 Part 2' }
      ]
    })
  })

  it('maps turn snapshots for React Flow and keeps real tree mutation disabled', async () => {
    const bridge = createConversationApi({
      treeId: 'tree-1', revision: 2, rootTurnId: 'a1', currentTurnId: 'a1',
      turns: [{
        id: 'a1', parentId: null, question: 'Q1', answer: 'A1', sequence: 0,
        createdAt: '2026-01-01T00:00:00.000Z'
      }]
    })
    const adapter = new ElectronConversationTreeUiAdapter(bridge.api)
    const snapshot = await adapter.getSnapshot()
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.value).toMatchObject({ rootId: 'a1', currentNodeId: 'a1' })

    const add = await adapter.addChildNode({ parentId: 'a1', question: 'Q2', answer: 'A2' })
    expect(add.ok).toBe(false)
    if (!add.ok) expect(add.error.code).toBe('NOT_IMPLEMENTED')
  })
})
