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
import { GenerationPreferencesService } from '../../apps/desktop/src/main/preferences/generation-preferences.service.js'
import { DeferredStreamingChatExecutor } from '../conversation-runtime/test-helpers.js'
import type { DesktopConversationEvent } from '../../apps/desktop/src/shared/conversation.contract.js'

describe('Desktop Conversation Service - Output Format & System Prompt Injection', () => {
  function setupTestService() {
    const treeService = new ConversationTreeService(new InMemoryConversationTreeRepository())
    const runtime = new ConversationRuntimeService(
      treeService,
      new InMemoryConversationCursorStore()
    )
    const executor = new DeferredStreamingChatExecutor()
    const modelProvider = new MutableConversationModelProvider({
      providerId: 'openai-compatible',
      modelId: 'test-model',
      executor
    })
    const preferencesService = new GenerationPreferencesService()
    const service = new DesktopConversationService(
      'pref-tree-1',
      treeService,
      runtime,
      modelProvider,
      preferencesService
    )

    return {
      service,
      treeService,
      executor,
      preferencesService
    }
  }

  it('injects active markdown template as synthetic system message and attaches format metadata on completion', async () => {
    const { service, executor, treeService } = setupTestService()
    const events: DesktopConversationEvent[] = []
    const sink = { emit: (e: DesktopConversationEvent) => events.push(e) }

    const accepted = await service.startTurn(
      {
        prompt: 'Calculate derivative',
        expectedRevision: 0,
        currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      sink
    )
    expect(accepted.ok).toBe(true)

    // Check executor received synthetic system message as the first message
    expect(executor.lastReceivedCommand?.messages).toHaveLength(2)
    const firstMsg = executor.lastReceivedCommand?.messages[0]
    expect(firstMsg?.role).toBe('system')
    expect(firstMsg?.content).toContain('CommonMark/GFM Markdown')

    const userMsg = executor.lastReceivedCommand?.messages[1]
    expect(userMsg?.role).toBe('user')
    expect(userMsg?.content).toBe('Calculate derivative')

    // System prompt is NOT a separate node in treeService
    const treeNodes = (await treeService.getTree('pref-tree-1')).value!.nodes
    expect(treeNodes.some((n) => n.role === 'system')).toBe(false)

    // Complete the turn
    executor.emitDelta('f\'(x) = 2x')
    executor.emitCompleted()

    await vi.waitFor(async () => {
      const snap = await service.getSnapshot()
      expect(snap.ok && snap.value.turns).toHaveLength(1)
    })

    const snapshot = (await service.getSnapshot()).value!
    const turn = snapshot.turns[0]
    expect(turn.declaredOutputFormat).toBe('markdown')
    expect(turn.templateVersion).toBe(1)
    expect(turn.answer).toBe('f\'(x) = 2x')
  })

  it('switches format preferences to html for next turn, while previous turns retain their format metadata', async () => {
    const { service, executor, preferencesService } = setupTestService()
    const events: DesktopConversationEvent[] = []
    const sink = { emit: (e: DesktopConversationEvent) => events.push(e) }

    // Turn 1 with Markdown
    await service.startTurn(
      {
        prompt: 'Question 1',
        expectedRevision: 0,
        currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      sink
    )
    executor.emitDelta('Answer 1')
    executor.emitCompleted()

    await vi.waitFor(async () => {
      const snap = await service.getSnapshot()
      expect(snap.ok && snap.value.turns).toHaveLength(1)
    })

    const snap1 = (await service.getSnapshot()).value!
    const turn1Id = snap1.currentTurnId!

    // Switch preferences to HTML
    preferencesService.savePreferences({
      activeFormat: 'html',
      markdownTemplate: preferencesService.getPreferences().value!.markdownTemplate,
      htmlTemplate: 'Custom HTML format instructions v2.'
    })

    // Turn 2 with HTML
    await service.startTurn(
      {
        prompt: 'Question 2',
        expectedRevision: snap1.revision,
        currentTurnId: turn1Id,
        contextSelection: { mode: 'root-path', turnIds: [turn1Id] }
      },
      sink
    )

    // Verify turn 2 received HTML system message
    const firstMsg = executor.lastReceivedCommand?.messages[0]
    expect(firstMsg?.role).toBe('system')
    expect(firstMsg?.content).toBe('Custom HTML format instructions v2.')

    executor.emitDelta('<p>Answer 2</p>')
    executor.emitCompleted()

    await vi.waitFor(async () => {
      const snap = await service.getSnapshot()
      expect(snap.ok && snap.value.turns).toHaveLength(2)
    })

    const snap2 = (await service.getSnapshot()).value!
    expect(snap2.turns[0].declaredOutputFormat).toBe('markdown')
    expect(snap2.turns[0].templateVersion).toBe(1)
    expect(snap2.turns[1].declaredOutputFormat).toBe('html')
    expect(snap2.turns[1].templateVersion).toBe(2)
  })

  it('does not leave format metadata if turn is cancelled', async () => {
    const { service, executor } = setupTestService()
    const events: DesktopConversationEvent[] = []
    const sink = { emit: (e: DesktopConversationEvent) => events.push(e) }

    await service.startTurn(
      {
        prompt: 'Question cancelled',
        expectedRevision: 0,
        currentTurnId: null,
        contextSelection: { mode: 'root-path', turnIds: [] }
      },
      sink
    )

    await service.cancelTurn()
    executor.emitCancelled()

    const snapshot = (await service.getSnapshot()).value!
    expect(snapshot.turns).toHaveLength(0)
  })
})
