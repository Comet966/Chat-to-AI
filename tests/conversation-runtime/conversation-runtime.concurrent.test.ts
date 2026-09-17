import { describe, expect, it } from 'vitest'
import {
  ConversationRuntimeService,
  InMemoryConversationCursorStore
} from '../../packages/conversation-runtime/src/index.js'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'
import { DeferredStreamingChatExecutor } from './test-helpers.js'

describe('ConversationRuntimeService - Concurrency and Version Conflict', () => {
  it('should atomically reserve an existing tree before asynchronous tree access', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const runtimeService = new ConversationRuntimeService(treeService)
    const executor = new DeferredStreamingChatExecutor()

    const created = await treeService.createTree({
      treeId: 'tree-atomic-reservation',
      root: { id: 'existing-root', role: 'user', content: 'Existing prompt' }
    })
    expect(created.ok).toBe(true)

    const firstTurn = runtimeService.sendMessage(
      {
        treeId: 'tree-atomic-reservation',
        prompt: 'First concurrent prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: () => {} }
    )
    const secondTurn = runtimeService.sendMessage(
      {
        treeId: 'tree-atomic-reservation',
        prompt: 'Second concurrent prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: () => {} }
    )

    const secondRes = await secondTurn
    expect(secondRes.ok).toBe(false)
    if (!secondRes.ok) {
      expect(secondRes.error.code).toBe('TURN_IN_PROGRESS')
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
    executor.emitDelta('First response')
    executor.emitCompleted()

    const firstRes = await firstTurn
    expect(firstRes.ok).toBe(true)

    const snapshot = (await treeService.getTree('tree-atomic-reservation')).value!
    expect(snapshot.nodes).toHaveLength(3)
    expect(snapshot.nodes.filter((node) => node.role === 'user')).toHaveLength(2)
  })

  it('should reject a second concurrent turn on the same tree with TURN_IN_PROGRESS', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new DeferredStreamingChatExecutor()

    // Start turn 1 (does not complete immediately)
    const turn1Promise = runtimeService.sendMessage(
      {
        treeId: 'tree-concurrent',
        prompt: 'First prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: () => {} }
    )

    // Wait a tick for start to be registered
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Start turn 2 on same tree
    const turn2Res = await runtimeService.sendMessage(
      {
        treeId: 'tree-concurrent',
        prompt: 'Second prompt while first is running',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: () => {} }
    )

    expect(turn2Res.ok).toBe(false)
    if (!turn2Res.ok) {
      expect(turn2Res.error.code).toBe('TURN_IN_PROGRESS')
    }

    // Try selectNode during turn 1
    const selectRes = await runtimeService.selectNode({
      treeId: 'tree-concurrent',
      nodeId: 'any-node'
    })
    expect(selectRes.ok).toBe(false)
    if (!selectRes.ok) {
      expect(selectRes.error.code).toBe('TURN_IN_PROGRESS')
    }

    // Now complete turn 1
    executor.emitStarted()
    executor.emitDelta('Done')
    executor.emitCompleted()

    const turn1Res = await turn1Promise
    expect(turn1Res.ok).toBe(true)
  })

  it('should allow concurrent turns across different trees', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const execA = new DeferredStreamingChatExecutor()
    const execB = new DeferredStreamingChatExecutor()

    const promiseA = runtimeService.sendMessage(
      {
        treeId: 'tree-A',
        prompt: 'Hello A',
        model: { providerId: 'p', modelId: 'm', executor: execA }
      },
      { emit: () => {} }
    )

    const promiseB = runtimeService.sendMessage(
      {
        treeId: 'tree-B',
        prompt: 'Hello B',
        model: { providerId: 'p', modelId: 'm', executor: execB }
      },
      { emit: () => {} }
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    execA.emitStarted()
    execA.emitDelta('Reply A')
    execA.emitCompleted()

    execB.emitStarted()
    execB.emitDelta('Reply B')
    execB.emitCompleted()

    const [resA, resB] = await Promise.all([promiseA, promiseB])
    expect(resA.ok).toBe(true)
    expect(resB.ok).toBe(true)
  })

  it('should handle version conflict if tree is mutated externally while streaming', async () => {
    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new DeferredStreamingChatExecutor()

    const turnPromise = runtimeService.sendMessage(
      {
        treeId: 'tree-conflict',
        prompt: 'Prompt',
        model: { providerId: 'p', modelId: 'm', executor }
      },
      { emit: () => {} }
    )

    await new Promise((resolve) => setTimeout(resolve, 10))
    executor.emitStarted()
    executor.emitDelta('Some delta')

    // Simulate external mutation before completed event:
    // Append a node externally with expectedVersion 1 (which bumps tree version to 2)
    const treeV1 = (await treeService.getTree('tree-conflict')).value!
    await treeService.appendNode({
      treeId: 'tree-conflict',
      expectedVersion: treeV1.version,
      parentId: treeV1.rootId,
      node: { id: 'external-interferer', role: 'assistant', content: 'Injected' }
    })

    // Now emit completion from executor; expectedVersion will conflict!
    executor.emitCompleted()

    const turnRes = await turnPromise
    expect(turnRes.ok).toBe(false)
    if (!turnRes.ok) {
      expect(turnRes.error.code).toBe('TREE_VERSION_CONFLICT')
    }

    // Verify external mutation was not overwritten
    const treeAfter = (await treeService.getTree('tree-conflict')).value!
    expect(treeAfter.nodes.some((n) => n.id === 'external-interferer')).toBe(true)
  })
})
