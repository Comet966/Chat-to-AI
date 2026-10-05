import { describe, expect, it } from 'vitest'
import {
  ConversationRuntimeService,
  InMemoryConversationCursorStore,
  type ConversationTurnEvent
} from '../../packages/conversation-runtime/src/index.js'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'
import { ScriptedStreamingChatExecutor } from './test-helpers.js'

describe('ConversationRuntimeService - Failure and Cancellation Flow', () => {
  it('should handle model executor rejection and roll back the incomplete root turn', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([], true, 'Provider unavailable')
    const events: ConversationTurnEvent[] = []

    const res = await runtimeService.sendMessage(
      {
        treeId: 'tree-fail-1',
        prompt: 'Hello fail',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: (e) => events.push(e) }
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('MODEL_REQUEST_REJECTED')
    }

    const tree = await treeService.getTree('tree-fail-1')
    expect(tree.ok).toBe(false)
    expect(cursorStore.get('tree-fail-1')).toBeUndefined()

    // Events emitted: started then failed
    expect(events.map((e) => e.type)).toEqual([
      'conversation.turn.started',
      'conversation.turn.failed'
    ])
  })

  it('should discard partial deltas on stream failure and not create assistant node', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Partial text that should' },
      { type: 'delta', text: ' be discarded' },
      { type: 'failed', message: 'Connection reset', code: 'PROVIDER_UNAVAILABLE' }
    ])

    const events: ConversationTurnEvent[] = []
    const res = await runtimeService.sendMessage(
      {
        treeId: 'tree-fail-2',
        prompt: 'Prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: (e) => events.push(e) }
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('MODEL_REQUEST_FAILED')
    }

    const tree = await treeService.getTree('tree-fail-2')
    expect(tree.ok).toBe(false)

    // Events included deltas, ending in failed
    const failedEvent = events.find((e) => e.type === 'conversation.turn.failed')
    expect(failedEvent).toBeDefined()
  })

  it('should handle cancellation properly without creating assistant node', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Some text' },
      { type: 'cancelled' }
    ])

    const events: ConversationTurnEvent[] = []
    const res = await runtimeService.sendMessage(
      {
        treeId: 'tree-cancel',
        prompt: 'Prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: (e) => events.push(e) }
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('MODEL_REQUEST_CANCELLED')
    }

    const tree = await treeService.getTree('tree-cancel')
    expect(tree.ok).toBe(false)
    expect(cursorStore.get('tree-cancel')).toBeUndefined()
  })

  it('should reject empty model response content with EMPTY_MODEL_RESPONSE', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: '   \n  \t' }, // Only whitespace
      { type: 'completed', finishReason: 'stop' }
    ])

    const events: ConversationTurnEvent[] = []
    const res = await runtimeService.sendMessage(
      {
        treeId: 'tree-empty',
        prompt: 'Prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: (e) => events.push(e) }
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('EMPTY_MODEL_RESPONSE')
    }

    const tree = await treeService.getTree('tree-empty')
    expect(tree.ok).toBe(false)
  })

  it('should allow subsequent message after a failure has occurred', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const failingExecutor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'failed', message: 'Fail' }
    ])

    await runtimeService.sendMessage(
      {
        treeId: 'tree-retry',
        prompt: 'Attempt 1',
        model: { providerId: 'p', modelId: 'm', executor: failingExecutor }
      },
      { emit: () => {} }
    )

    // Now send Attempt 2 (which should be accepted because active turn lock was released)
    const succeedingExecutor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Success on retry' },
      { type: 'completed', finishReason: 'stop' }
    ])

    const res2 = await runtimeService.sendMessage(
      {
        treeId: 'tree-retry',
        prompt: 'Attempt 2',
        model: { providerId: 'p', modelId: 'm', executor: succeedingExecutor }
      },
      { emit: () => {} }
    )

    expect(res2.ok).toBe(true)
    const tree = (await treeService.getTree('tree-retry')).value!
    // The failed first attempt was fully rolled back.
    expect(tree.nodes).toHaveLength(2)
  })

  it('should restore the previous assistant cursor when a later branch turn fails', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const first = await runtimeService.sendMessage(
      {
        treeId: 'tree-later-failure',
        prompt: 'Successful turn',
        model: {
          providerId: 'p',
          modelId: 'm',
          executor: new ScriptedStreamingChatExecutor([
            { type: 'started' },
            { type: 'delta', text: 'Successful answer' },
            { type: 'completed', finishReason: 'stop' }
          ])
        }
      },
      { emit: () => {} }
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const failed = await runtimeService.sendMessage(
      {
        treeId: 'tree-later-failure',
        prompt: 'This turn fails',
        model: {
          providerId: 'p',
          modelId: 'm',
          executor: new ScriptedStreamingChatExecutor([
            { type: 'started' },
            { type: 'failed', message: 'Provider failed' }
          ])
        }
      },
      { emit: () => {} }
    )

    expect(failed.ok).toBe(false)
    const snapshot = (await treeService.getTree('tree-later-failure')).value!
    expect(snapshot.nodes).toHaveLength(2)
    expect(cursorStore.get('tree-later-failure')).toBe(first.value.assistantNodeId)
  })
})
