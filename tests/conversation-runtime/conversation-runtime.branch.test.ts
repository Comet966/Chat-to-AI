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

describe('ConversationRuntimeService - Branching and Selection', () => {
  it('should support switching nodes and creating a true branch from a historical assistant node', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    // Turn 1: U1 -> A1
    const executor1 = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Answer 1' },
      { type: 'completed', finishReason: 'stop' }
    ])
    const turn1 = await runtimeService.sendMessage(
      {
        treeId: 'tree-branch',
        prompt: 'User question 1',
        model: { providerId: 'p', modelId: 'm', executor: executor1 }
      },
      { emit: () => {} }
    )
    expect(turn1.ok).toBe(true)
    const a1Id = turn1.value!.assistantNodeId

    // Turn 2: A1 -> U2 -> A2
    const executor2 = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Answer 2' },
      { type: 'completed', finishReason: 'stop' }
    ])
    const turn2 = await runtimeService.sendMessage(
      {
        treeId: 'tree-branch',
        prompt: 'User question 2 (branch A)',
        model: { providerId: 'p', modelId: 'm', executor: executor2 }
      },
      { emit: () => {} }
    )
    expect(turn2.ok).toBe(true)

    // Now select A1 to branch from it!
    const versionBeforeSelect = (await treeService.getTree('tree-branch')).value!.version
    const selectRes = await runtimeService.selectNode({
      treeId: 'tree-branch',
      nodeId: a1Id
    })
    expect(selectRes.ok).toBe(true)
    if (selectRes.ok) {
      expect(selectRes.value.currentNodeId).toBe(a1Id)
    }

    // Version must NOT change on select
    const versionAfterSelect = (await treeService.getTree('tree-branch')).value!.version
    expect(versionAfterSelect).toBe(versionBeforeSelect)

    // Turn 3: from A1 -> U3 -> A3
    const executor3 = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Answer 3 (branch B)' },
      { type: 'completed', finishReason: 'stop' }
    ])
    const turn3 = await runtimeService.sendMessage(
      {
        treeId: 'tree-branch',
        prompt: 'User question 3 (branch B)',
        model: { providerId: 'p', modelId: 'm', executor: executor3 }
      },
      { emit: () => {} }
    )
    expect(turn3.ok).toBe(true)
    if (!turn3.ok) return

    expect(turn3.value.baseNodeId).toBe(a1Id)

    // CRITICAL: Context for Turn 3 must contain ONLY U1 -> A1 -> U3, NOT U2 or A2!
    expect(executor3.lastReceivedCommand?.messages).toEqual([
      { role: 'user', content: 'User question 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'User question 3 (branch B)' }
    ])

    // Verify tree has 2 branches and 2 leaves
    const leavesRes = await treeService.listLeaves('tree-branch')
    expect(leavesRes.value!.map((l) => l.id)).toEqual([
      turn2.value!.assistantNodeId,
      turn3.value.assistantNodeId
    ])

    const branchesRes = await treeService.listBranches('tree-branch')
    expect(branchesRes.value).toHaveLength(2)
  })

  it('should reject selecting non-existent node or non-existent tree', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    // Non-existent tree
    const sel1 = await runtimeService.selectNode({
      treeId: 'tree-ghost',
      nodeId: 'node-1'
    })
    expect(sel1.ok).toBe(false)
    if (!sel1.ok) {
      expect(sel1.error.code).toBe('TREE_NOT_FOUND')
    }

    // Create a tree
    await runtimeService.sendMessage(
      {
        treeId: 'tree-real',
        prompt: 'Hello',
        model: {
          providerId: 'p',
          modelId: 'm',
          executor: new ScriptedStreamingChatExecutor()
        }
      },
      { emit: () => {} }
    )

    // Non-existent node
    const sel2 = await runtimeService.selectNode({
      treeId: 'tree-real',
      nodeId: 'ghost-node'
    })
    expect(sel2.ok).toBe(false)
    if (!sel2.ok) {
      expect(sel2.error.code).toBe('NODE_NOT_FOUND')
    }
  })

  it('should maintain independent cursors for different trees', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const turnA = await runtimeService.sendMessage(
      {
        treeId: 'tree-A',
        prompt: 'Alpha',
        model: { providerId: 'p', modelId: 'm', executor: new ScriptedStreamingChatExecutor() }
      },
      { emit: () => {} }
    )

    const turnB = await runtimeService.sendMessage(
      {
        treeId: 'tree-B',
        prompt: 'Beta',
        model: { providerId: 'p', modelId: 'm', executor: new ScriptedStreamingChatExecutor() }
      },
      { emit: () => {} }
    )

    expect(cursorStore.get('tree-A')).toBe(turnA.value!.assistantNodeId)
    expect(cursorStore.get('tree-B')).toBe(turnB.value!.assistantNodeId)
  })
})
