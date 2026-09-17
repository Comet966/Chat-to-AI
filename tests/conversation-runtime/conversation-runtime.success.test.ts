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

describe('ConversationRuntimeService - Success Flow', () => {
  it('should create new tree with prompt as root on first turn and append assistant upon completion', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world!' },
      { type: 'completed', finishReason: 'stop' }
    ])

    const events: ConversationTurnEvent[] = []
    const turnResult = await runtimeService.sendMessage(
      {
        treeId: 'tree-1',
        prompt: 'First prompt',
        model: {
          providerId: 'openai-compatible',
          modelId: 'gpt-4o',
          executor
        }
      },
      { emit: (evt) => events.push(evt) }
    )

    expect(turnResult.ok).toBe(true)
    if (!turnResult.ok) return

    expect(turnResult.value.treeId).toBe('tree-1')
    expect(turnResult.value.baseNodeId).toBeNull()
    expect(turnResult.value.finishReason).toBe('stop')
    expect(turnResult.value.treeVersion).toBe(2) // 1 for user root, 2 for assistant

    // Check events emitted
    expect(events.map((e) => e.type)).toEqual([
      'conversation.turn.started',
      'conversation.turn.delta',
      'conversation.turn.delta',
      'conversation.turn.completed'
    ])

    // Verify tree snapshot
    const treeRes = await treeService.getTree('tree-1')
    expect(treeRes.ok).toBe(true)
    if (!treeRes.ok) return

    const snapshot = treeRes.value
    expect(snapshot.nodes).toHaveLength(2)

    const userNode = snapshot.nodes[0]
    expect(userNode.id).toBe(turnResult.value.userNodeId)
    expect(userNode.role).toBe('user')
    expect(userNode.content).toBe('First prompt')
    expect(userNode.parentId).toBeNull()

    const assistantNode = snapshot.nodes[1]
    expect(assistantNode.id).toBe(turnResult.value.assistantNodeId)
    expect(assistantNode.role).toBe('assistant')
    expect(assistantNode.content).toBe('Hello world!')
    expect(assistantNode.parentId).toBe(userNode.id)
    expect(assistantNode.generatedBy).toEqual({
      providerId: 'openai-compatible',
      modelId: 'gpt-4o'
    })

    // Verify cursor updated to assistant
    expect(cursorStore.get('tree-1')).toBe(assistantNode.id)
    const curRes = await runtimeService.getCurrentNode('tree-1')
    expect(curRes.ok).toBe(true)
    if (curRes.ok) {
      expect(curRes.value.id).toBe(assistantNode.id)
    }
  })

  it('should continue linearly on existing tree appending user under previous assistant and new assistant under user', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor1 = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Ans 1' },
      { type: 'completed', finishReason: 'stop' }
    ])

    const turn1 = await runtimeService.sendMessage(
      {
        treeId: 'tree-linear',
        prompt: 'Prompt 1',
        model: { providerId: 'p1', modelId: 'm1', executor: executor1 }
      },
      { emit: () => {} }
    )
    expect(turn1.ok).toBe(true)
    if (!turn1.ok) return

    const executor2 = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Ans 2' },
      { type: 'completed', finishReason: 'length' }
    ])

    const turn2 = await runtimeService.sendMessage(
      {
        treeId: 'tree-linear',
        prompt: 'Prompt 2',
        model: { providerId: 'p2', modelId: 'm2', executor: executor2 }
      },
      { emit: () => {} }
    )
    expect(turn2.ok).toBe(true)
    if (!turn2.ok) return

    expect(turn2.value.baseNodeId).toBe(turn1.value.assistantNodeId)
    expect(turn2.value.finishReason).toBe('length')
    expect(turn2.value.treeVersion).toBe(4) // 1 (u1) -> 2 (a1) -> 3 (u2) -> 4 (a2)

    // Verify context sent to executor2 contains all 3 previous items + current user
    expect(executor2.lastReceivedCommand?.messages).toEqual([
      { role: 'user', content: 'Prompt 1' },
      { role: 'assistant', content: 'Ans 1' },
      { role: 'user', content: 'Prompt 2' }
    ])

    // Verify cursor updated to second assistant
    expect(cursorStore.get('tree-linear')).toBe(turn2.value.assistantNodeId)
  })
})
