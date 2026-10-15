import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ChatKernel } from 'chat-core'
import { createModelAdapter, resolveProviderConfig, type ProviderConfig } from 'chat-model-adapters'
import { ConversationRuntimeService, InMemoryConversationCursorStore } from 'chat-conversation-runtime'
import { ConversationTreeService, InMemoryConversationTreeRepository } from 'chat-conversation-tree'
import type { NamedChatAttachment } from 'chat-contracts'
import { DesktopConversationService, MutableConversationModelProvider } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'
import { ConversationTransport } from '../../apps/desktop/src/main/conversation/conversation.transport.js'
import { SenderPolicy } from '../../apps/desktop/src/main/security/sender-policy.js'
import { createDesktopBridge } from '../../apps/desktop/src/preload/desktop-api.js'
import { DESKTOP_IPC_CHANNELS } from '../../apps/desktop/src/shared/desktop-api.contract.js'
import { ElectronChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-chat-ui.adapter.js'
import { DesktopConversationStorage } from '../../apps/desktop/src/main/storage/desktop-conversation.storage.js'

// Valid tiny PNG. Tests never read arbitrary user files.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNKsAAAAASUVORK5CYII='
const attachment: NamedChatAttachment = { name: 'sample.png', attachment: { type: 'image', mediaType: 'image/png', source: { type: 'base64', data: png } } }

function desktopSession(config: ProviderConfig, storage?: DesktopConversationStorage) {
  const tree = new ConversationTreeService(storage ?? new InMemoryConversationTreeRepository())
  const cursors = new InMemoryConversationCursorStore()
  const selected = storage?.getSelection('multimodal-desktop')
  if (selected) cursors.set('multimodal-desktop', selected)
  const runtime = new ConversationRuntimeService(tree, cursors, undefined, storage)
  const kernel = new ChatKernel(createModelAdapter(config))
  const model = new MutableConversationModelProvider({ providerId: config.provider, modelId: config.modelId, executor: kernel })
  const service = new DesktopConversationService('multimodal-desktop', tree, runtime, model, undefined, storage)
  const listeners = new Set<(event: unknown, payload: unknown) => void>()
  const caller = {
    sender: { isDestroyed: () => false, send: (_channel: string, payload: unknown) => {
      for (const listener of listeners) listener({}, payload)
    } }, senderFrame: { url: 'http://localhost:5173/', parent: null }
  } as unknown as IpcMainInvokeEvent
  const transport = new ConversationTransport({ service, senderPolicy: new SenderPolicy({ allowedOrigins: ['http://localhost:5173'] }) })
  const bridge = createDesktopBridge({
    invoke: async (channel, payload) => {
      if (channel === DESKTOP_IPC_CHANNELS.CONVERSATION_GET_SNAPSHOT) return transport.handleGetSnapshot(caller, payload)
      if (channel === DESKTOP_IPC_CHANNELS.CONVERSATION_START_TURN) return transport.handleStartTurn(caller, payload)
      if (channel === DESKTOP_IPC_CHANNELS.CONVERSATION_CANCEL_TURN) return transport.handleCancelTurn(caller, payload)
      throw new Error('Unexpected channel')
    },
    on: (_channel, listener) => { listeners.add(listener) },
    removeListener: (_channel, listener) => { listeners.delete(listener) }
  })
  const ui = new ElectronChatUiAdapter(bridge.conversation)
  ui.connect()
  return { tree, service, transport, caller, bridge, ui }
}

describe('desktop multimodal HTTP integration', () => {
  it('passes an image through the full bridge, streams output, and reuses persisted historical media after restart', async () => {
    const requests: Record<string, any>[] = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (part) => { body += part })
      req.on('end', () => {
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"Blue"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":" square"}}]}\n\n')
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const directory = await mkdtemp(join(tmpdir(), 'chat-desktop-multimodal-'))
    const config: ProviderConfig = { provider: 'openai-compatible', baseUrl, apiKey: 'smoke-only', modelId: 'vision', maxOutputTokens: 256 }
    let session = desktopSession(config, await DesktopConversationStorage.open(directory))
    const streamed: string[] = []
    const unsubscribe = session.ui.subscribe((state) => { if (state.status === 'streaming') streamed.push(state.messages.at(-1)?.content ?? '') })
    try {
      await session.bridge.conversation.getSnapshot()
      const common = { expectedRevision: 0, currentNodeId: null, contextSelection: { mode: 'root-path' as const, nodeIds: [] } }
      expect((await session.ui.sendMessage({ ...common, content: 'Describe this', attachments: [attachment] })).ok).toBe(true)
      await vi.waitFor(() => expect(session.ui.getState().status).toBe('idle'))
      expect(requests[0].messages.at(-1).content).toContainEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } })
      expect(streamed).toContain('Blue')
      expect(streamed).toContain('Blue square')
      const snapshot = await session.service.getSnapshot()
      if (!snapshot.ok) throw new Error('Missing snapshot')
      expect(snapshot.value.turns[0].question).toContain('sample.png')
      expect(JSON.stringify(snapshot.value)).not.toContain(png)
      unsubscribe(); session.ui.dispose(); await session.service.shutdown()
      session = desktopSession(config, await DesktopConversationStorage.open(directory))
      expect(await session.service.getSnapshot()).toEqual(snapshot)
      expect((await session.ui.sendMessage({ ...common, expectedRevision: snapshot.value.revision,
        currentNodeId: snapshot.value.currentTurnId, content: 'Continue' })).ok).toBe(true)
      await vi.waitFor(() => expect(requests).toHaveLength(2))
      await vi.waitFor(() => expect(session.ui.getState().status).toBe('idle'))
      expect(requests[1].messages.find((message: any) => message.role === 'user').content).toContainEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } })
      expect(requests[1].messages.at(-1).content).toBe('Continue')
      const tree = await session.tree.getTree('multimodal-desktop')
      expect(JSON.stringify(tree)).not.toContain(png)
      for (const bad of [
        { ...attachment, name: '/private/sample.png' },
        { ...attachment, path: '/private/sample.png' },
        { ...attachment, attachment: { type: 'image', mediaType: 'image/svg+xml', source: { type: 'base64', data: png } } }
      ]) {
        expect(await session.transport.handleStartTurn(session.caller, { prompt: 'Bad', attachments: [bad],
          expectedRevision: 4, currentTurnId: null, contextSelection: { mode: 'root-path', turnIds: [] } }))
          .toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
      }
      expect(requests).toHaveLength(2)
    } finally {
      unsubscribe(); session.ui.dispose(); await session.service.cancelTurn()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe.skipIf(process.env.AI_RUN_DESKTOP_MULTIMODAL_LIVE_TEST !== '1')('desktop live multimodal input', () => {
  it('sends a test PNG through desktop IPC handlers and receives streaming text', async () => {
    const resolved = resolveProviderConfig()
    if (!resolved.success) throw new Error(resolved.error)
    const directory = await mkdtemp(join(tmpdir(), 'chat-desktop-multimodal-live-'))
    let session = desktopSession(resolved.config, await DesktopConversationStorage.open(directory))
    const outputs: string[] = []
    let unsubscribe = session.ui.subscribe((state) => { if (state.status === 'streaming') outputs.push(state.messages.at(-1)?.content ?? '') })
    try {
      const sent = await session.ui.sendMessage({ content: 'Describe this tiny test image briefly. Reply with text only; do not generate any images.', attachments: [attachment],
        expectedRevision: 0, currentNodeId: null, contextSelection: { mode: 'root-path', nodeIds: [] } })
      expect(sent.ok).toBe(true)
      await vi.waitFor(() => expect(['idle', 'failed', 'cancelled']).toContain(session.ui.getState().status), { timeout: 150000 })
      const state = session.ui.getState()
      expect(state.error).toBeNull()
      expect(state.messages.at(-1)?.role).toBe('assistant')
      expect(state.messages.at(-1)?.content.trim()).not.toBe('')
      expect(outputs.some((text) => text.trim())).toBe(true)
      expect(JSON.stringify(await session.service.getSnapshot())).not.toContain(png)
      const snapshot = await session.service.getSnapshot()
      if (!snapshot.ok) throw new Error('Missing snapshot')
      unsubscribe(); session.ui.dispose(); await session.service.shutdown()
      session = desktopSession(resolved.config, await DesktopConversationStorage.open(directory))
      expect(await session.service.getSnapshot()).toEqual(snapshot)
      unsubscribe = session.ui.subscribe((next) => { if (next.status === 'streaming') outputs.push(next.messages.at(-1)?.content ?? '') })
      expect((await session.ui.sendMessage({ content: 'Look at the original image again. What color is it? Text only.',
        expectedRevision: snapshot.value.revision, currentNodeId: snapshot.value.currentTurnId, contextSelection: { mode: 'root-path', nodeIds: [] } })).ok).toBe(true)
      await vi.waitFor(() => expect(['idle', 'failed', 'cancelled']).toContain(session.ui.getState().status), { timeout: 150000 })
      expect(session.ui.getState().error).toBeNull()
      expect(session.ui.getState().messages.at(-1)?.content.trim()).not.toBe('')
      console.info(`Desktop live multimodal passed: two turns with restart, persisted image reused; ${outputs.filter((text) => text.trim()).length} streaming updates.`)
    } finally { unsubscribe(); session.ui.dispose(); await session.service.shutdown(); await rm(directory, { recursive: true, force: true }) }
  }, 320000)
})
