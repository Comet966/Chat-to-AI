import { describe, expect, it } from 'vitest'
import {
  ConversationRuntimeService,
  InMemoryConversationCursorStore
} from '../../packages/conversation-runtime/src/index.js'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'
import { ScriptedStreamingChatExecutor } from './test-helpers.js'

function successfulExecutor(answer: string): ScriptedStreamingChatExecutor {
  return new ScriptedStreamingChatExecutor([
    { type: 'started' },
    { type: 'delta', text: answer },
    { type: 'completed', finishReason: 'stop' }
  ])
}

describe('ConversationRuntimeService - Explicit Context Selection', () => {
  it('uses ordered message pairs as context without changing the branch attachment point', async () => {
    const treeService = new ConversationTreeService(new InMemoryConversationTreeRepository())
    const runtime = new ConversationRuntimeService(
      treeService,
      new InMemoryConversationCursorStore()
    )

    const first = await runtime.sendMessage(
      {
        treeId: 'tree-explicit',
        prompt: 'Question 1',
        model: { providerId: 'p', modelId: 'm', executor: successfulExecutor('Answer 1') }
      },
      { emit: () => {} }
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await runtime.sendMessage(
      {
        treeId: 'tree-explicit',
        prompt: 'Question 2',
        model: { providerId: 'p', modelId: 'm', executor: successfulExecutor('Answer 2') }
      },
      { emit: () => {} }
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return

    await runtime.selectNode({
      treeId: 'tree-explicit',
      nodeId: first.value.assistantNodeId
    })
    const branch = await runtime.sendMessage(
      {
        treeId: 'tree-explicit',
        prompt: 'Question on branch B',
        model: { providerId: 'p', modelId: 'm', executor: successfulExecutor('Branch answer') }
      },
      { emit: () => {} }
    )
    expect(branch.ok).toBe(true)
    if (!branch.ok) return

    const explicitExecutor = successfulExecutor('Explicit answer')
    const explicit = await runtime.sendMessage(
      {
        treeId: 'tree-explicit',
        prompt: 'Use selected turns',
        contextSelection: {
          mode: 'explicit-nodes',
          nodeIds: [
            first.value.userNodeId,
            first.value.assistantNodeId,
            second.value.userNodeId,
            second.value.assistantNodeId
          ]
        },
        model: { providerId: 'p', modelId: 'm', executor: explicitExecutor }
      },
      { emit: () => {} }
    )

    expect(explicit.ok).toBe(true)
    if (!explicit.ok) return
    expect(explicit.value.baseNodeId).toBe(branch.value.assistantNodeId)
    expect(explicitExecutor.lastReceivedCommand?.messages).toEqual([
      { role: 'user', content: 'Question 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Question 2' },
      { role: 'assistant', content: 'Answer 2' },
      { role: 'user', content: 'Use selected turns' }
    ])
  })

  it('rejects invalid explicit selections and restores the previous cursor and tree', async () => {
    const treeService = new ConversationTreeService(new InMemoryConversationTreeRepository())
    const cursorStore = new InMemoryConversationCursorStore()
    const runtime = new ConversationRuntimeService(treeService, cursorStore)
    const first = await runtime.sendMessage(
      {
        treeId: 'tree-invalid-explicit',
        prompt: 'Question 1',
        model: { providerId: 'p', modelId: 'm', executor: successfulExecutor('Answer 1') }
      },
      { emit: () => {} }
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const versionBefore = (await treeService.getTree('tree-invalid-explicit')).value!.version

    const result = await runtime.sendMessage(
      {
        treeId: 'tree-invalid-explicit',
        prompt: 'Invalid selection',
        contextSelection: {
          mode: 'explicit-nodes',
          nodeIds: [first.value.userNodeId, first.value.userNodeId]
        },
        model: { providerId: 'p', modelId: 'm', executor: successfulExecutor('unused') }
      },
      { emit: () => {} }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_CONTEXT_SELECTION')
    const snapshot = (await treeService.getTree('tree-invalid-explicit')).value!
    expect(snapshot.nodes).toHaveLength(2)
    expect(snapshot.version).toBe(versionBefore + 2)
    expect(cursorStore.get('tree-invalid-explicit')).toBe(first.value.assistantNodeId)
  })
})
