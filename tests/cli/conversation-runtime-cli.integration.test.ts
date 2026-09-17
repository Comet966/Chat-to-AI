import { describe, expect, it } from 'vitest'
import { ChatKernel, type ChatModelPort } from 'chat-core'
import type { ChatRole } from 'chat-contracts'
import {
  ConversationRuntimeService,
  InMemoryConversationCursorStore,
  type ConversationTurnEvent,
  type StreamingChatExecutor
} from 'chat-conversation-runtime'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'

class FakeIntegrationChatModel implements ChatModelPort {
  public readonly modelId = 'fake-model-integration'
  public receivedMessages: ReadonlyArray<{ role: ChatRole; content: string }> = []

  public async *streamChat(
    input: { messages: ReadonlyArray<{ role: ChatRole; content: string }> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  > {
    this.receivedMessages = input.messages

    if (signal.aborted) return
    yield { type: 'text-delta', text: 'First part of response, ' }

    if (signal.aborted) return
    yield { type: 'text-delta', text: 'second part of response.' }

    if (signal.aborted) return
    yield { type: 'finish', finishReason: 'stop' }
  }
}

describe('ConversationRuntime + ChatKernel Integration', () => {
  it('should seamlessly execute turns using real ChatKernel instance satisfying StreamingChatExecutor', async () => {
    const fakeModel = new FakeIntegrationChatModel()
    const realKernel = new ChatKernel(fakeModel)

    // Verify realKernel satisfies StreamingChatExecutor structurally
    const executor: StreamingChatExecutor = realKernel

    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtime = new ConversationRuntimeService(treeService, cursorStore)

    const events: ConversationTurnEvent[] = []
    const turn1Result = await runtime.sendMessage(
      {
        treeId: 'integration-tree',
        prompt: 'What is the speed of light?',
        model: {
          providerId: 'openai-compatible',
          modelId: 'fake-model-integration',
          executor
        }
      },
      { emit: (e) => events.push(e) }
    )

    expect(turn1Result.ok).toBe(true)
    if (!turn1Result.ok) return

    expect(turn1Result.value.treeVersion).toBe(2)
    expect(turn1Result.value.finishReason).toBe('stop')

    // Verify model received the prompt
    expect(fakeModel.receivedMessages).toEqual([
      { role: 'user', content: 'What is the speed of light?' }
    ])

    // Verify events were emitted properly
    expect(events.map((e) => e.type)).toEqual([
      'conversation.turn.started',
      'conversation.turn.delta',
      'conversation.turn.delta',
      'conversation.turn.completed'
    ])

    // Verify tree contains completed assistant node with combined content
    const tree = (await treeService.getTree('integration-tree')).value!
    expect(tree.nodes).toHaveLength(2)
    const assistantNode = tree.nodes[1]
    expect(assistantNode.content).toBe('First part of response, second part of response.')
    expect(assistantNode.role).toBe('assistant')
    expect(assistantNode.generatedBy).toEqual({
      providerId: 'openai-compatible',
      modelId: 'fake-model-integration'
    })

    // Verify cursor moved to assistant
    expect(cursorStore.get('integration-tree')).toBe(assistantNode.id)
  })
})
