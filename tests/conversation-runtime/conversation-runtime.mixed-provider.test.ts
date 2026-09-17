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

describe('ConversationRuntimeService - Mixed Provider and Provenance Flow', () => {
  it('should support multiple turns with distinct providers and models in the same tree', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    // Turn 1: OpenAI
    const execOpenAI = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Answer from OpenAI' },
      { type: 'completed', finishReason: 'stop' }
    ])
    const turn1 = await runtimeService.sendMessage(
      {
        treeId: 'tree-multi-model',
        prompt: 'First prompt',
        model: { providerId: 'openai-compatible', modelId: 'gpt-4o', executor: execOpenAI }
      },
      { emit: () => {} }
    )
    expect(turn1.ok).toBe(true)

    // Turn 2: Anthropic
    const execAnthropic = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Answer from Claude' },
      { type: 'completed', finishReason: 'stop' }
    ])
    const turn2 = await runtimeService.sendMessage(
      {
        treeId: 'tree-multi-model',
        prompt: 'Second prompt',
        model: { providerId: 'anthropic', modelId: 'claude-3-7-sonnet', executor: execAnthropic }
      },
      { emit: () => {} }
    )
    expect(turn2.ok).toBe(true)

    // Turn 3: Gemini
    const execGemini = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Answer from Gemini' },
      { type: 'completed', finishReason: 'stop' }
    ])
    const turn3 = await runtimeService.sendMessage(
      {
        treeId: 'tree-multi-model',
        prompt: 'Third prompt',
        model: { providerId: 'gemini', modelId: 'gemini-2.5-flash', executor: execGemini }
      },
      { emit: () => {} }
    )
    expect(turn3.ok).toBe(true)

    // Verify messages passed to Gemini only contains role and content, no secrets or provider config
    expect(execGemini.lastReceivedCommand?.messages).toEqual([
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'Answer from OpenAI' },
      { role: 'user', content: 'Second prompt' },
      { role: 'assistant', content: 'Answer from Claude' },
      { role: 'user', content: 'Third prompt' }
    ])

    // Verify tree snapshot
    const tree = (await treeService.getTree('tree-multi-model')).value!
    expect(tree.nodes).toHaveLength(6)

    const a1 = tree.nodes.find((n) => n.id === turn1.value!.assistantNodeId)
    expect(a1?.generatedBy).toEqual({
      providerId: 'openai-compatible',
      modelId: 'gpt-4o'
    })

    const a2 = tree.nodes.find((n) => n.id === turn2.value!.assistantNodeId)
    expect(a2?.generatedBy).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet'
    })

    const a3 = tree.nodes.find((n) => n.id === turn3.value!.assistantNodeId)
    expect(a3?.generatedBy).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash'
    })

    // Validate that no API keys or secret tokens exist in snapshot JSON
    const snapshotStr = JSON.stringify(tree)
    expect(snapshotStr).not.toContain('apiKey')
    expect(snapshotStr).not.toContain('authorization')
    expect(snapshotStr).not.toContain('Authorization')
    expect(snapshotStr).not.toContain('Bearer')
  })
})
