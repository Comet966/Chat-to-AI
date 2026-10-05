// @vitest-environment jsdom
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
import { ProviderRuntimeService } from '../../apps/desktop/src/main/provider/provider-runtime.service.js'
import { ElectronChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-chat-ui.adapter.js'
import { ElectronConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-conversation-tree-ui.adapter.js'
import { ElectronProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-provider-settings.adapter.js'
import { DeferredStreamingChatExecutor } from '../conversation-runtime/test-helpers.js'
import type { DesktopConversationEvent } from '../../apps/desktop/src/shared/conversation.contract.js'
import type { DesktopApi } from '../../apps/desktop/src/shared/desktop-api.contract.js'

function setupFullDesktopStack() {
  const treeRepository = new InMemoryConversationTreeRepository()
  const treeService = new ConversationTreeService(treeRepository)
  const cursorStore = new InMemoryConversationCursorStore()
  const runtime = new ConversationRuntimeService(treeService, cursorStore)

  const activeExecutor = new DeferredStreamingChatExecutor()
  const modelProvider = new MutableConversationModelProvider({
    providerId: 'openai-compatible',
    modelId: 'gpt-4o',
    executor: activeExecutor
  })

  const conversationService = new DesktopConversationService(
    'e2e-test-tree',
    treeService,
    runtime,
    modelProvider
  )

  const providerService = new ProviderRuntimeService({
    modelProvider,
    hasActiveTurn: () => runtime.hasActiveTurn('e2e-test-tree'),
    initialConfig: {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-key-12345',
      modelId: 'gpt-4o',
      maxOutputTokens: 2048
    }
  })

  // Ensure activeExecutor is set for runtime execution in this test
  modelProvider.setCurrentModel({
    providerId: 'openai-compatible',
    modelId: 'gpt-4o',
    executor: activeExecutor
  })

  // Set up event hub simulating IPC
  const eventListeners = new Set<(event: DesktopConversationEvent) => void>()
  const sink = {
    emit(event: DesktopConversationEvent) {
      for (const listener of [...eventListeners]) {
        listener(event)
      }
    }
  }

  const bridgeApi: DesktopApi = {
    app: {
      getInfo: async () => ({ ok: true, value: { name: 'Chat Desktop', version: '0.1.0' } })
    },
    conversation: {
      getSnapshot: () => conversationService.getSnapshot(),
      setCurrentTurn: async ({ turnId, expectedRevision }) => {
        const res = await conversationService.setCurrentTurn(turnId, expectedRevision)
        if (res.ok) {
          sink.emit({
            type: 'conversation.snapshot.changed',
            schemaVersion: 1,
            treeId: res.value.treeId,
            snapshot: res.value
          })
        }
        return res
      },
      startTurn: (input) => conversationService.startTurn(input, sink),
      cancelTurn: () => conversationService.cancelTurn(),
      onEvent: (listener) => {
        eventListeners.add(listener)
        return () => eventListeners.delete(listener)
      }
    },
    provider: {
      getSettings: async () => providerService.getSettings(),
      saveSettings: async (input) => providerService.saveSettings(input),
      clearKey: async () => providerService.clearKey(),
      testConnection: async () => providerService.testConnection(),
      listModels: async (input) => providerService.listModels(input),
      getDevPreset: async () => providerService.getDevPreset()
    },
    preferences: {
      getPreferences: async () => ({
        ok: true,
        value: {
          activeFormat: 'markdown',
          markdownTemplate: 'Format as markdown',
          htmlTemplate: 'Format as html',
          version: 1
        }
      }),
      savePreferences: async () => ({ ok: true, value: undefined }),
      setActiveFormat: async () => ({ ok: true, value: undefined })
    }
  }

  const chatAdapter = new ElectronChatUiAdapter(bridgeApi.conversation)
  const treeAdapter = new ElectronConversationTreeUiAdapter(bridgeApi.conversation)
  const providerAdapter = new ElectronProviderSettingsAdapter(bridgeApi.provider)
  chatAdapter.connect()
  treeAdapter.connect()

  return {
    executor: activeExecutor,
    modelProvider,
    chatAdapter,
    treeAdapter,
    providerAdapter,
    cleanup() {
      chatAdapter.dispose()
      treeAdapter.dispose()
    }
  }
}

describe('Desktop End-to-End Dialog & Rendering Flow', () => {
  it('completes multi-turn conversation, branches from historical turn, and verifies consistency', async () => {
    const stack = setupFullDesktopStack()
    await Promise.resolve()

    // 1. Initial State
    const initialTreeSnapshot = await stack.treeAdapter.getSnapshot()
    expect(initialTreeSnapshot.ok).toBe(true)
    if (!initialTreeSnapshot.ok) return
    expect(initialTreeSnapshot.value.nodes).toHaveLength(0)

    const initialProvider = await stack.providerAdapter.getSettings()
    expect(initialProvider.ok).toBe(true)
    if (!initialProvider.ok) return
    expect(initialProvider.value.modelId).toBe('gpt-4o')
    expect(initialProvider.value.hasApiKey).toBe(true)
    // Key must not be leaked back
    expect(initialProvider.value.apiKey).toBe('')

    // 2. Send Turn 1
    const send1 = await stack.chatAdapter.sendMessage({
      content: 'Hello, what is AI?',
      expectedRevision: initialTreeSnapshot.value.revision,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })
    expect(send1.ok).toBe(true)
    expect(stack.chatAdapter.getState().status).toBe('streaming')

    // Stream deltas
    stack.executor.emitDelta('Artificial Intelligence ')
    stack.executor.emitDelta('is machine intelligence.')
    stack.executor.emitCompleted()

    // Wait for snapshot changed event to settle
    await vi.waitFor(() => {
      expect(stack.chatAdapter.getState().status).toBe('idle')
      expect(stack.chatAdapter.getState().messages).toHaveLength(2)
    })

    const turn1Snapshot = await stack.treeAdapter.getSnapshot()
    expect(turn1Snapshot.ok).toBe(true)
    if (!turn1Snapshot.ok) return
    expect(turn1Snapshot.value.nodes).toHaveLength(1)
    const turn1Node = turn1Snapshot.value.nodes[0]
    expect(turn1Node.question).toBe('Hello, what is AI?')
    expect(turn1Node.answer).toBe('Artificial Intelligence is machine intelligence.')
    const turn1Id = turn1Node.id

    // 3. Send Turn 2 (sequential reply on Turn 1)
    const send2 = await stack.chatAdapter.sendMessage({
      content: 'Can you give an example?',
      expectedRevision: turn1Snapshot.value.revision,
      currentNodeId: turn1Id,
      contextSelection: { mode: 'root-path', nodeIds: [turn1Id] }
    })
    expect(send2.ok).toBe(true)

    // Verify context received by executor contains synthetic system message + turn 1
    expect(stack.executor.lastReceivedCommand?.messages).toHaveLength(4)
    expect(stack.executor.lastReceivedCommand?.messages[0].role).toBe('system')
    expect(stack.executor.lastReceivedCommand?.messages[1].content).toBe('Hello, what is AI?')

    stack.executor.emitDelta('An example is a self-driving car.')
    stack.executor.emitCompleted()

    await vi.waitFor(() => {
      expect(stack.chatAdapter.getState().status).toBe('idle')
      expect(stack.chatAdapter.getState().messages).toHaveLength(4)
    })

    const turn2Snapshot = await stack.treeAdapter.getSnapshot()
    expect(turn2Snapshot.ok).toBe(true)
    if (!turn2Snapshot.ok) return
    expect(turn2Snapshot.value.nodes).toHaveLength(2)
    const turn2Node = turn2Snapshot.value.nodes.find((n) => n.parentId === turn1Id)
    expect(turn2Node).toBeDefined()
    expect(turn2Node?.answer).toBe('An example is a self-driving car.')
    const turn2Id = turn2Node!.id

    // 4. Switch current turn back to Turn 1 (Historical Node)
    const switchBack = await stack.treeAdapter.setCurrentNode(turn1Id)
    expect(switchBack.ok).toBe(true)

    // Chat adapter messages should now show ONLY root path to turn 1 (2 messages)
    await vi.waitFor(() => {
      const messages = stack.chatAdapter.getState().messages
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('Hello, what is AI?')
      expect(messages[1].content).toBe('Artificial Intelligence is machine intelligence.')
    })

    // 5. Branch from Turn 1 with a new question
    const branchedSnapshot = await stack.treeAdapter.getSnapshot()
    if (!branchedSnapshot.ok) return
    const sendBranch = await stack.chatAdapter.sendMessage({
      content: 'What about computer vision?',
      expectedRevision: branchedSnapshot.value.revision,
      currentNodeId: turn1Id,
      contextSelection: { mode: 'root-path', nodeIds: [turn1Id] }
    })
    expect(sendBranch.ok).toBe(true)

    stack.executor.emitDelta('Computer vision processes visual inputs.')
    stack.executor.emitCompleted()

    await vi.waitFor(() => {
      expect(stack.chatAdapter.getState().status).toBe('idle')
      expect(stack.chatAdapter.getState().messages).toHaveLength(4)
    })

    // Verify tree has 3 nodes: root turn 1, child turn 2, and branch turn 3
    const finalTree = await stack.treeAdapter.getSnapshot()
    expect(finalTree.ok).toBe(true)
    if (!finalTree.ok) return
    expect(finalTree.value.nodes).toHaveLength(3)

    const branchChildren = finalTree.value.nodes.filter((n) => n.parentId === turn1Id)
    expect(branchChildren).toHaveLength(2)
    const branchAnswers = branchChildren.map((n) => n.answer)
    expect(branchAnswers).toContain('An example is a self-driving car.')
    expect(branchAnswers).toContain('Computer vision processes visual inputs.')

    stack.cleanup()
  })

  it('cancels turn cleanly without leaving pseudo-completed nodes in tree', async () => {
    const stack = setupFullDesktopStack()
    await Promise.resolve()

    const initialTree = await stack.treeAdapter.getSnapshot()
    if (!initialTree.ok) return

    await stack.chatAdapter.sendMessage({
      content: 'Will be cancelled',
      expectedRevision: initialTree.value.revision,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    expect(stack.chatAdapter.getState().status).toBe('streaming')
    stack.executor.emitDelta('Starting to write...')

    // Cancel request
    await stack.chatAdapter.cancel()
    stack.executor.emitCancelled()

    await vi.waitFor(() => {
      expect(stack.chatAdapter.getState().status).toBe('cancelled')
    })

    // Tree must NOT contain any completed nodes
    const treeAfterCancel = await stack.treeAdapter.getSnapshot()
    expect(treeAfterCancel.ok).toBe(true)
    if (!treeAfterCancel.ok) return
    expect(treeAfterCancel.value.nodes).toHaveLength(0)

    stack.cleanup()
  })

  it('preserves mixed-format raw content across incremental deltas', async () => {
    const stack = setupFullDesktopStack()
    await Promise.resolve()

    const initialTree = await stack.treeAdapter.getSnapshot()
    if (!initialTree.ok) return

    await stack.chatAdapter.sendMessage({
      content: 'Formatting question',
      expectedRevision: initialTree.value.revision,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })

    // Deliver first delta with markdown formatting
    stack.executor.emitDelta('### Section 1\n\n')
    expect(stack.chatAdapter.getState().messages.at(-1)?.content).toBe('### Section 1\n\n')

    // Deliver second delta with HTML fragment
    stack.executor.emitDelta('<p>HTML paragraph with <strong>bold</strong></p>\n\n')
    expect(stack.chatAdapter.getState().messages.at(-1)?.content).toBe(
      '### Section 1\n\n<p>HTML paragraph with <strong>bold</strong></p>\n\n'
    )

    // Deliver third delta with code block
    stack.executor.emitDelta('```ts\nconst x = 1;\n```')
    stack.executor.emitCompleted()

    await vi.waitFor(() => {
      expect(stack.chatAdapter.getState().status).toBe('idle')
    })

    const finalMessage = stack.chatAdapter.getState().messages.at(-1)
    expect(finalMessage?.role).toBe('assistant')
    expect(finalMessage?.content).toBe(
      '### Section 1\n\n<p>HTML paragraph with <strong>bold</strong></p>\n\n```ts\nconst x = 1;\n```'
    )

    stack.cleanup()
  })
})
