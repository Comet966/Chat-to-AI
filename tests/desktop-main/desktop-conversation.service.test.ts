import { describe, expect, it, vi } from 'vitest'
import {
  ConversationRuntimeService,
  InMemoryConversationCursorStore
} from 'chat-conversation-runtime'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'
import {
  DesktopConversationService,
  MutableConversationModelProvider
} from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'
import type { DesktopConversationEvent } from '../../apps/desktop/src/shared/conversation.contract.js'
import { DeferredStreamingChatExecutor } from '../conversation-runtime/test-helpers.js'

function createService(executor: DeferredStreamingChatExecutor | null) {
  const treeService = new ConversationTreeService(new InMemoryConversationTreeRepository())
  const runtime = new ConversationRuntimeService(
    treeService,
    new InMemoryConversationCursorStore()
  )
  const modelProvider = new MutableConversationModelProvider(
    executor
      ? { providerId: 'openai-compatible', modelId: 'test-model', executor }
      : null
  )
  return {
    service: new DesktopConversationService('desktop-tree', treeService, runtime, modelProvider),
    modelProvider
  }
}

describe('DesktopConversationService', () => {
  it('returns a stable empty snapshot and rejects sending without a configured model', async () => {
    const { service } = createService(null)
    const snapshot = await service.getSnapshot()
    expect(snapshot).toEqual({
      ok: true,
      value: {
        treeId: 'desktop-tree', revision: 0, rootTurnId: null, currentTurnId: null, turns: []
      }
    })

    const sent = await service.startTurn(
      {
        prompt: 'hello', expectedRevision: 0, currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      { emit: () => {} }
    )
    expect(sent).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'Configure an AI provider before sending a message' }
    })
  })

  it('forwards streaming deltas and publishes one completed turn snapshot', async () => {
    const executor = new DeferredStreamingChatExecutor()
    const { service } = createService(executor)
    const events: DesktopConversationEvent[] = []

    const accepted = await service.startTurn(
      {
        prompt: 'What is streaming?', expectedRevision: 0, currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      { emit: (event) => events.push(event) }
    )
    expect(accepted.ok).toBe(true)
    executor.emitDelta('Part one')
    executor.emitDelta(' and two')
    executor.emitCompleted()

    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'conversation.snapshot.changed')).toHaveLength(1)
    })
    expect(events.map((event) => event.type)).toEqual([
      'conversation.turn.started',
      'conversation.turn.delta',
      'conversation.turn.delta',
      'conversation.turn.completed',
      'conversation.snapshot.changed'
    ])
    const snapshotEvent = events.at(-1)
    expect(snapshotEvent?.type).toBe('conversation.snapshot.changed')
    if (snapshotEvent?.type !== 'conversation.snapshot.changed') return
    expect(snapshotEvent.snapshot.turns[0]).toMatchObject({
      question: 'What is streaming?',
      answer: 'Part one and two',
      providerInfo: { provider: 'openai-compatible', modelId: 'test-model' }
    })
    expect(snapshotEvent.snapshot.currentTurnId).toBe(snapshotEvent.snapshot.turns[0].id)
  })

  it('validates revision before starting a turn', async () => {
    const executor = new DeferredStreamingChatExecutor()
    const { service } = createService(executor)
    const result = await service.startTurn(
      {
        prompt: 'stale', expectedRevision: 99, currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      { emit: () => {} }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VERSION_CONFLICT')
    expect(executor.lastReceivedCommand).toBeUndefined()
  })

  it('sorts manual context turns while keeping the current turn as the branch parent', async () => {
    const firstExecutor = new DeferredStreamingChatExecutor()
    const { service, modelProvider } = createService(firstExecutor)
    const events: DesktopConversationEvent[] = []
    const sink = { emit: (event: DesktopConversationEvent) => events.push(event) }

    await service.startTurn(
      {
        prompt: 'Q1', expectedRevision: 0, currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      sink
    )
    firstExecutor.emitDelta('A1')
    firstExecutor.emitCompleted()
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'conversation.snapshot.changed')).toHaveLength(1)
    })
    const firstSnapshot = (await service.getSnapshot()).value!
    const firstTurnId = firstSnapshot.currentTurnId!

    const secondExecutor = new DeferredStreamingChatExecutor()
    modelProvider.setCurrentModel({
      providerId: 'anthropic', modelId: 'second-model', executor: secondExecutor
    })
    await service.startTurn(
      {
        prompt: 'Q2', expectedRevision: firstSnapshot.revision, currentTurnId: firstTurnId,
        contextSelection: { mode: 'root-path', turnIds: [firstTurnId] }
      },
      sink
    )
    secondExecutor.emitDelta('A2')
    secondExecutor.emitCompleted()
    await vi.waitFor(async () => {
      const snapshot = await service.getSnapshot()
      expect(snapshot.ok && snapshot.value.turns).toHaveLength(2)
    })
    const secondSnapshot = (await service.getSnapshot()).value!
    const secondTurnId = secondSnapshot.currentTurnId!

    const selected = await service.setCurrentTurn(firstTurnId, secondSnapshot.revision)
    expect(selected.ok).toBe(true)
    const selectedSnapshot = selected.value!

    const branchExecutor = new DeferredStreamingChatExecutor()
    modelProvider.setCurrentModel({
      providerId: 'gemini', modelId: 'branch-model', executor: branchExecutor
    })
    await service.startTurn(
      {
        prompt: 'Q branch',
        expectedRevision: selectedSnapshot.revision,
        currentTurnId: firstTurnId,
        contextSelection: { mode: 'root-path', turnIds: [firstTurnId] }
      },
      sink
    )
    branchExecutor.emitDelta('A branch')
    branchExecutor.emitCompleted()
    await vi.waitFor(async () => {
      const snapshot = await service.getSnapshot()
      expect(snapshot.ok && snapshot.value.turns).toHaveLength(3)
    })
    const branchSnapshot = (await service.getSnapshot()).value!
    const branchTurnId = branchSnapshot.currentTurnId!

    const manualExecutor = new DeferredStreamingChatExecutor()
    modelProvider.setCurrentModel({
      providerId: 'openai-compatible', modelId: 'manual-model', executor: manualExecutor
    })
    const accepted = await service.startTurn(
      {
        prompt: 'Q manual',
        expectedRevision: branchSnapshot.revision,
        currentTurnId: branchTurnId,
        contextSelection: { mode: 'manual', turnIds: [secondTurnId, firstTurnId] }
      },
      sink
    )

    expect(accepted.ok).toBe(true)
    expect(manualExecutor.lastReceivedCommand?.messages).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'Q manual' }
    ])
    manualExecutor.emitCancelled()
  })
})
