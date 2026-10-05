import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
import type { DesktopConversationEvent } from '../../apps/desktop/src/shared/conversation.contract.js'

describe('Desktop Provider Real HTTP Smoke Test', () => {
  let server: http.Server
  let serverUrl: string
  const SMOKE_KEY = 'smoke-secret-key-987'

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? ''
      const method = req.method ?? ''

      // Model listing endpoint
      if (url.includes('/models') && method === 'GET') {
        if (req.headers.authorization !== `Bearer ${SMOKE_KEY}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'o3-mini' }]
          })
        )
        return
      }

      // OpenAI-compatible Chat Completions streaming endpoint
      if (url.includes('/chat/completions') && method === 'POST') {
        if (req.headers.authorization !== `Bearer ${SMOKE_KEY}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Unauthorized' } }))
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })

        // Stream real SSE deltas
        res.write('data: {"choices":[{"delta":{"content":"### Smoke Test Answer\\n\\n"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":"This is **streaming** via real HTTP."}}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        serverUrl = `http://127.0.0.1:${address.port}/v1`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('connects to real HTTP endpoint, verifies credentials, and streams chat turn to ElectronChatUiAdapter', async () => {
    const treeService = new ConversationTreeService(new InMemoryConversationTreeRepository())
    const runtime = new ConversationRuntimeService(treeService, new InMemoryConversationCursorStore())
    const modelProvider = new MutableConversationModelProvider(null)

    const providerService = new ProviderRuntimeService({
      modelProvider,
      hasActiveTurn: () => runtime.hasActiveTurn('smoke-tree'),
      initialConfig: {
        provider: 'openai-compatible',
        baseUrl: serverUrl,
        apiKey: SMOKE_KEY,
        modelId: 'gpt-4o',
        maxOutputTokens: 1024
      }
    })

    // 1. Verify connection and list models over real HTTP
    const testConn = await providerService.testConnection()
    expect(testConn.ok).toBe(true)

    const catalog = await providerService.listModels({
      provider: 'openai-compatible',
      baseUrl: serverUrl,
      apiKey: SMOKE_KEY,
      modelId: 'gpt-4o',
      maxOutputTokens: 1024
    })
    expect(catalog.ok).toBe(true)
    if (!catalog.ok) return
    expect(catalog.value.models).toEqual(['gpt-4o', 'gpt-4o-mini', 'o3-mini'])

    // 2. Set up DesktopConversationService with real ChatKernel installed by providerService
    const conversationService = new DesktopConversationService(
      'smoke-tree',
      treeService,
      runtime,
      modelProvider
    )

    const events: DesktopConversationEvent[] = []
    const listeners = new Set<(event: DesktopConversationEvent) => void>()
    const sink = {
      emit(event: DesktopConversationEvent) {
        events.push(event)
        for (const listener of listeners) listener(event)
      }
    }

    const bridgeConversation = {
      getSnapshot: () => conversationService.getSnapshot(),
      setCurrentTurn: (input: { turnId: string; expectedRevision: number }) =>
        conversationService.setCurrentTurn(input.turnId, input.expectedRevision),
      startTurn: (input: any) => conversationService.startTurn(input, sink),
      cancelTurn: () => conversationService.cancelTurn(),
      onEvent: (listener: (event: DesktopConversationEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }

    const chatAdapter = new ElectronChatUiAdapter(bridgeConversation)
    chatAdapter.connect()
    await Promise.resolve()

    // 3. Send message over the wire
    const sendResult = await chatAdapter.sendMessage({
      content: 'Run smoke test',
      expectedRevision: 0,
      currentNodeId: null,
      contextSelection: { mode: 'root-path', nodeIds: [] }
    })
    expect(sendResult.ok).toBe(true)

    // 4. Wait for real HTTP SSE stream to complete and update adapter
    await vi.waitFor(
      () => {
        expect(chatAdapter.getState().status).toBe('idle')
        expect(chatAdapter.getState().messages).toHaveLength(2)
      },
      { timeout: 3000 }
    )

    const finalAssistantMessage = chatAdapter.getState().messages.find((m) => m.role === 'assistant')
    expect(finalAssistantMessage?.content).toBe(
      '### Smoke Test Answer\n\nThis is **streaming** via real HTTP.'
    )

    // 5. Verify conversation tree snapshot was updated
    const treeSnapshot = await conversationService.getSnapshot()
    expect(treeSnapshot.ok).toBe(true)
    if (!treeSnapshot.ok) return
    expect(treeSnapshot.value.turns).toHaveLength(1)
    expect(treeSnapshot.value.turns[0].answer).toBe(
      '### Smoke Test Answer\n\nThis is **streaming** via real HTTP.'
    )
    expect(treeSnapshot.value.turns[0].providerInfo).toEqual({
      provider: 'openai-compatible',
      modelId: 'gpt-4o'
    })

    chatAdapter.dispose()
  })
})
