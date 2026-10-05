// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../apps/desktop/src/shared/desktop-api.contract.js'
import type {
  ConversationSnapshotDto,
  DesktopConversationEvent
} from '../../apps/desktop/src/shared/conversation.contract.js'
import { ElectronChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-chat-ui.adapter.js'
import { ElectronConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-conversation-tree-ui.adapter.js'
import type { ConversationTreeSnapshot } from '../../apps/desktop/src/renderer/src/ports/conversation-tree-ui.port.js'

function createConversationApi(initialSnapshot: ConversationSnapshotDto) {
  const listeners = new Set<(event: DesktopConversationEvent) => void>()
  let currentSnapshot = initialSnapshot

  const api: DesktopApi['conversation'] = {
    getSnapshot: vi.fn().mockImplementation(async () => ({ ok: true, value: currentSnapshot })),
    setCurrentTurn: vi.fn().mockImplementation(async ({ turnId }) => {
      currentSnapshot = { ...currentSnapshot, currentTurnId: turnId }
      return { ok: true, value: currentSnapshot }
    }),
    startTurn: vi.fn().mockImplementation(async () => {
      const started: DesktopConversationEvent = {
        type: 'conversation.turn.started',
        schemaVersion: 1,
        requestId: 'request-1',
        treeId: currentSnapshot.treeId
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
    getListenerCount() {
      return listeners.size
    },
    emit(event: DesktopConversationEvent) {
      for (const listener of [...listeners]) listener(event)
    }
  }
}

const emptySnapshot: ConversationSnapshotDto = {
  treeId: 'tree-1',
  revision: 0,
  rootTurnId: null,
  currentTurnId: null,
  turns: []
}

describe('Electron renderer conversation adapters', () => {
  it('appends streaming deltas to one pending assistant and replaces it from completed snapshot', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    const sent = await adapter.sendMessage({
      content: 'Question',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })
    expect(sent.ok).toBe(true)
    expect(adapter.getState().status).toBe('streaming')

    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 0,
      delta: 'Part 1'
    })
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 1,
      delta: ' Part 2'
    })
    expect(adapter.getState().messages.at(-1)?.content).toBe('Part 1 Part 2')

    bridge.emit({
      type: 'conversation.turn.completed',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      finishReason: 'stop'
    })
    expect(adapter.getState().status).toBe('completed')

    bridge.emit({
      type: 'conversation.snapshot.changed',
      schemaVersion: 1,
      treeId: 'tree-1',
      snapshot: {
        treeId: 'tree-1',
        revision: 2,
        rootTurnId: 'a1',
        currentTurnId: 'a1',
        turns: [
          {
            id: 'a1',
            parentId: null,
            question: 'Question',
            answer: 'Part 1 Part 2',
            sequence: 0,
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
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

  it('reassembles out-of-order deltas by sequence and ignores duplicate sequences', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    await adapter.sendMessage({
      content: 'Sort test',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    // Emit sequence 2, then 0, then 1, plus duplicate 1
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 2,
      delta: ' [Three]'
    })
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 0,
      delta: '[One]'
    })
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 1,
      delta: ' [Two]'
    })
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 1,
      delta: ' [Two]'
    })

    expect(adapter.getState().messages.at(-1)?.content).toBe('[One] [Two] [Three]')
  })

  it('ignores deltas and terminal events for unknown or expired request IDs', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    await adapter.sendMessage({
      content: 'Request ID test',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    // Event with unknown request ID
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'unknown-request',
      sequence: 0,
      delta: 'Should be ignored'
    })
    expect(adapter.getState().messages.at(-1)?.content).toBe('')

    // Completed with unknown request ID
    bridge.emit({
      type: 'conversation.turn.completed',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'unknown-request',
      finishReason: 'stop'
    })
    expect(adapter.getState().status).toBe('streaming')
  })

  it('transitions to cancelled and cleans up pending assistant on cancel event', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    await adapter.sendMessage({
      content: 'Cancel test',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    expect(adapter.getState().messages.some((m) => m.role === 'assistant')).toBe(true)

    bridge.emit({
      type: 'conversation.turn.cancelled',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1'
    })

    const state = adapter.getState()
    expect(state.status).toBe('cancelled')
    // Pending assistant removed
    expect(state.messages.some((m) => m.role === 'assistant')).toBe(false)
  })

  it('transitions to failed and records error message on fail event', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    await adapter.sendMessage({
      content: 'Fail test',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    bridge.emit({
      type: 'conversation.turn.failed',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      error: { code: 'MODEL_REQUEST_FAILED', message: 'Rate limit exceeded' }
    })

    const state = adapter.getState()
    expect(state.status).toBe('failed')
    expect(state.error).toBe('Rate limit exceeded')
    expect(state.messages.some((m) => m.role === 'assistant')).toBe(false)
  })

  it('ignores late deltas after turn is completed', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    await adapter.sendMessage({
      content: 'Late delta test',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 0,
      delta: 'Initial'
    })

    bridge.emit({
      type: 'conversation.turn.completed',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      finishReason: 'stop'
    })

    // Now emit a late delta
    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 1,
      delta: ' Late addition'
    })

    expect(adapter.getState().messages.at(-1)?.content).toBe('Initial')
  })

  it('connects idempotently and can reconnect after StrictMode-style disposal', async () => {
    const bridge = createConversationApi(emptySnapshot)
    const chatAdapter = new ElectronChatUiAdapter(bridge.api)
    const treeAdapter = new ElectronConversationTreeUiAdapter(bridge.api)

    expect(bridge.getListenerCount()).toBe(0)

    chatAdapter.connect()
    treeAdapter.connect()
    expect(bridge.getListenerCount()).toBe(2)

    chatAdapter.connect()
    treeAdapter.connect()
    expect(bridge.getListenerCount()).toBe(2)

    chatAdapter.dispose()
    expect(bridge.getListenerCount()).toBe(1)

    chatAdapter.connect()
    expect(bridge.getListenerCount()).toBe(2)

    chatAdapter.dispose()
    treeAdapter.dispose()
    expect(bridge.getListenerCount()).toBe(0)
  })

  it('does not let a delayed initial snapshot overwrite an active turn', async () => {
    const bridge = createConversationApi(emptySnapshot)
    let resolveInitialSnapshot!: (result: {
      ok: true
      value: ConversationSnapshotDto
    }) => void
    const delayedInitialSnapshot = new Promise<{
      ok: true
      value: ConversationSnapshotDto
    }>((resolve) => {
      resolveInitialSnapshot = resolve
    })
    bridge.api.getSnapshot = vi.fn(() => delayedInitialSnapshot)

    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()

    const sent = await adapter.sendMessage({
      content: 'Do not overwrite this turn',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })
    expect(sent.ok).toBe(true)

    resolveInitialSnapshot({ ok: true, value: emptySnapshot })
    await delayedInitialSnapshot
    await Promise.resolve()

    expect(adapter.getState().status).toBe('streaming')
    expect(adapter.getState().messages.map((message) => message.content)).toEqual([
      'Do not overwrite this turn',
      ''
    ])

    bridge.emit({
      type: 'conversation.turn.delta',
      schemaVersion: 1,
      treeId: 'tree-1',
      requestId: 'request-1',
      sequence: 0,
      delta: 'Still connected'
    })
    expect(adapter.getState().messages.at(-1)?.content).toBe('Still connected')
  })

  it('updates message list to root-path when switching current turn in snapshot', async () => {
    const twoTurnSnapshot: ConversationSnapshotDto = {
      treeId: 'tree-1',
      revision: 4,
      rootTurnId: 't1',
      currentTurnId: 't2',
      turns: [
        {
          id: 't1',
          parentId: null,
          question: 'Q1',
          answer: 'A1',
          sequence: 0,
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 't2',
          parentId: 't1',
          question: 'Q2',
          answer: 'A2',
          sequence: 1,
          createdAt: '2026-01-01T00:01:00.000Z'
        }
      ]
    }

    const bridge = createConversationApi(twoTurnSnapshot)
    const adapter = new ElectronChatUiAdapter(bridge.api)
    adapter.connect()
    await Promise.resolve()

    // Initially current is t2 -> messages should show t1 and t2 (4 messages)
    expect(adapter.getState().messages).toHaveLength(4)

    // Switch current to t1 -> messages should show only t1 (2 messages)
    bridge.emit({
      type: 'conversation.snapshot.changed',
      schemaVersion: 1,
      treeId: 'tree-1',
      snapshot: {
        ...twoTurnSnapshot,
        currentTurnId: 't1'
      }
    })

    expect(adapter.getState().messages).toHaveLength(2)
    expect(adapter.getState().messages.map((m) => m.content)).toEqual(['Q1', 'A1'])
  })

  it('maps turn snapshots for React Flow and keeps real tree mutation disabled', async () => {
    const bridge = createConversationApi({
      treeId: 'tree-1',
      revision: 2,
      rootTurnId: 'a1',
      currentTurnId: 'a1',
      turns: [
        {
          id: 'a1',
          parentId: null,
          question: 'Q1',
          answer: 'A1',
          sequence: 0,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
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

  it('does not let a delayed reload remove nodes from a newer pushed tree snapshot', async () => {
    const oldSnapshot: ConversationSnapshotDto = {
      treeId: 'tree-1',
      revision: 2,
      rootTurnId: 't1',
      currentTurnId: 't1',
      turns: [
        {
          id: 't1',
          parentId: null,
          question: 'Q1',
          answer: 'A1',
          sequence: 0,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
    const newSnapshot: ConversationSnapshotDto = {
      ...oldSnapshot,
      revision: 4,
      currentTurnId: 't2',
      turns: [
        ...oldSnapshot.turns,
        {
          id: 't2',
          parentId: 't1',
          question: 'Q2',
          answer: 'A2',
          sequence: 1,
          createdAt: '2026-01-01T00:01:00.000Z'
        }
      ]
    }
    const bridge = createConversationApi(oldSnapshot)
    let resolveReload!: (result: { ok: true; value: ConversationSnapshotDto }) => void
    const delayedReload = new Promise<{ ok: true; value: ConversationSnapshotDto }>((resolve) => {
      resolveReload = resolve
    })
    bridge.api.getSnapshot = vi.fn(() => delayedReload)

    const adapter = new ElectronConversationTreeUiAdapter(bridge.api)
    const observedSnapshots: ConversationTreeSnapshot[] = []
    adapter.connect()
    adapter.subscribe((snapshot) => observedSnapshots.push(snapshot))

    const reloadResultPromise = adapter.reload()
    bridge.emit({
      type: 'conversation.snapshot.changed',
      schemaVersion: 1,
      treeId: 'tree-1',
      snapshot: newSnapshot
    })
    resolveReload({ ok: true, value: oldSnapshot })

    const reloadResult = await reloadResultPromise
    expect(reloadResult.ok).toBe(true)
    if (!reloadResult.ok) return
    expect(reloadResult.value).toMatchObject({ revision: 4, currentNodeId: 't2' })
    expect(reloadResult.value.nodes.map((node) => node.id)).toEqual(['t1', 't2'])
    expect(observedSnapshots).toHaveLength(1)
    expect(observedSnapshots[0].nodes.map((node) => node.id)).toEqual(['t1', 't2'])
  })
})
