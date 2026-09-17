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
  it('should handle model executor rejection and leave user node as current', async () => {
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

    // User node was created and retained
    const tree = (await treeService.getTree('tree-fail-1')).value!
    expect(tree.nodes).toHaveLength(1)
    expect(tree.nodes[0].role).toBe('user')

    // Cursor points to user node
    expect(cursorStore.get('tree-fail-1')).toBe(tree.nodes[0].id)

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

    // Snapshot has NO assistant node
    const tree = (await treeService.getTree('tree-fail-2')).value!
    expect(tree.nodes).toHaveLength(1)
    expect(tree.nodes[0].role).toBe('user')

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

    const tree = (await treeService.getTree('tree-cancel')).value!
    expect(tree.nodes).toHaveLength(1)
    expect(cursorStore.get('tree-cancel')).toBe(tree.nodes[0].id)
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

    const tree = (await treeService.getTree('tree-empty')).value!
    expect(tree.nodes).toHaveLength(1) // No assistant created
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
    // Tree has user1, user2, assistant2
    expect(tree.nodes).toHaveLength(3)
  })
})
