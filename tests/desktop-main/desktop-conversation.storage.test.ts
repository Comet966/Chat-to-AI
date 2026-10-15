import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile, unlink, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ConversationTreeService } from 'chat-conversation-tree'
import { ConversationRuntimeService, InMemoryConversationCursorStore } from 'chat-conversation-runtime'
import type { NamedChatAttachment } from 'chat-contracts'
import { DesktopConversationStorage } from '../../apps/desktop/src/main/storage/desktop-conversation.storage.js'
import { DesktopConversationService, MutableConversationModelProvider } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'
import { GenerationPreferencesService } from '../../apps/desktop/src/main/preferences/generation-preferences.service.js'
import { DeferredStreamingChatExecutor, ScriptedStreamingChatExecutor } from '../conversation-runtime/test-helpers.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const file: NamedChatAttachment = { name: 'plot.png', attachment: { type: 'image', mediaType: 'image/png', source: { type: 'base64', data: Buffer.from('test-image-content').toString('base64') } } }
const blobId = createHash('sha256').update(Buffer.from(file.attachment.source.data, 'base64')).digest('hex')
const model = (executor: ScriptedStreamingChatExecutor | DeferredStreamingChatExecutor) => ({ providerId: 'test', modelId: 'vision', executor })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'chat-attachment-storage-'))
  directories.push(directory)
  const storage = await DesktopConversationStorage.open(directory)
  const tree = new ConversationTreeService(storage)
  const runtime = new ConversationRuntimeService(tree, undefined, undefined, storage)
  return { directory, storage, tree, runtime }
}
async function send(runtime: ConversationRuntimeService, prompt = 'Describe', attachments?: NamedChatAttachment[], selectedNodeId?: string) {
  const executor = new ScriptedStreamingChatExecutor()
  const result = await runtime.sendMessage({ treeId: 'saved', prompt, ...(attachments ? { attachments } : {}),
    ...(selectedNodeId ? { selectedNodeId } : {}), model: model(executor) }, { emit() {} })
  if (!result.ok) throw new Error(result.error.message)
  return { ...result.value, executor }
}

describe('desktop persistent conversation attachments', () => {
  it.each([
    { ...file, attachment: { ...file.attachment, detail: 'high' as const } },
    { name: 'notes.pdf', attachment: { type: 'document' as const, mediaType: 'application/pdf' as const, filename: 'notes.pdf', source: { type: 'base64' as const, data: 'JVBERi0xLjQ=' } } },
    { name: 'sample.wav', attachment: { type: 'audio' as const, mediaType: 'audio/wav' as const, source: { type: 'base64' as const, data: 'UklGRndhdmU=' } } }
  ])('round-trips $name with its media type and provider metadata', async (item) => {
    const { directory, runtime } = await setup()
    const first = await send(runtime, 'Read media', [item])
    const reopened = await DesktopConversationStorage.open(directory)
    expect((await reopened.loadForNodes('saved', [first.userNodeId])).get(first.userNodeId)).toEqual([item])
  })

  it('stores deduplicated blobs separately from tree/state, restores context after restart, and owns its input', async () => {
    const { directory, storage, runtime } = await setup()
    const mutable = structuredClone(file)
    const first = await send(runtime, 'First', [mutable])
    mutable.name = 'changed.png'
    mutable.attachment.source.data = 'bXV0YXRlZA=='
    await send(runtime, 'Second same bytes', [{ ...file, name: 'copy.png' }])
    expect(await readdir(join(directory, 'blobs'))).toEqual([`${blobId}.bin`])
    expect(await readFile(join(directory, 'blobs', `${blobId}.bin`))).toEqual(Buffer.from(file.attachment.source.data, 'base64'))
    const stateText = await readFile(join(directory, 'state.json'), 'utf8')
    const state = JSON.parse(stateText)
    expect(state.attachments).toHaveLength(2)
    expect(state.attachments[0].files[0]).toMatchObject({ id: blobId, name: 'plot.png', size: 18 })
    expect(stateText).not.toContain(file.attachment.source.data)
    expect(stateText).not.toContain(directory)
    expect(state.trees[0].nodes.every((node: any) => !('attachments' in node))).toBe(true)
    await storage.flush()
    const reopened = await DesktopConversationStorage.open(directory)
    const resumed = new ConversationRuntimeService(new ConversationTreeService(reopened), undefined, undefined, reopened)
    const next = await send(resumed, 'Again without uploading', undefined, first.assistantNodeId)
    expect(next.executor.lastReceivedCommand?.messages[0].attachments).toEqual([file.attachment])
    expect(next.executor.lastReceivedCommand?.messages.at(-1)?.attachments).toBeUndefined()
    expect(next.executor.lastReceivedCommand?.messages).toHaveLength(3)
    const recoveredFiles = await reopened.loadForNodes('saved', [first.userNodeId])
    expect(recoveredFiles.get(first.userNodeId)?.[0].name).toBe('plot.png')
    expect(JSON.stringify(await reopened.load('saved'))).not.toContain(file.attachment.source.data)
  })

  it('loads only the chosen branch or explicit context, preserving attachments across model switches', async () => {
    const { storage, tree, runtime } = await setup()
    const root = await send(runtime, 'Root', undefined)
    const withFile = await send(runtime, 'Branch with file', [file], root.assistantNodeId)
    const sibling = await send(runtime, 'Sibling without file', undefined, root.assistantNodeId)
    const onSibling = await send(runtime, 'Only sibling', undefined, sibling.assistantNodeId)
    expect(onSibling.executor.lastReceivedCommand?.messages.every((message) => !message.attachments)).toBe(true)
    const executor = new ScriptedStreamingChatExecutor()
    expect((await runtime.sendMessage({ treeId: 'saved', prompt: 'Manual chosen file', selectedNodeId: sibling.assistantNodeId,
      contextSelection: { mode: 'explicit-nodes', nodeIds: [withFile.userNodeId, withFile.assistantNodeId] },
      systemPrompt: 'Describe media', model: { ...model(executor), providerId: 'another-protocol', modelId: 'another-vision-model' }
    }, { emit() {} })).ok).toBe(true)
    expect(executor.lastReceivedCommand?.messages[0]).toMatchObject({ role: 'system', content: 'Describe media' })
    expect(executor.lastReceivedCommand?.messages[1].attachments).toEqual([file.attachment])
    const snapshot = await tree.getTree('saved')
    if (!snapshot.ok) throw new Error('Missing tree')
    expect(snapshot.value.nodes.at(-1)?.generatedBy).toEqual({ providerId: 'another-protocol', modelId: 'another-vision-model' })
    expect((await storage.loadForNodes('saved', [root.userNodeId, sibling.userNodeId])).size).toBe(0)
  })

  it.each(['missing', 'corrupt', 'symlink'] as const)('reports %s media before model dispatch and rolls back only the new turn', async (failure) => {
    const { directory, storage, runtime } = await setup()
    const first = await send(runtime, 'Describe', [file])
    const path = join(directory, 'blobs', `${blobId}.bin`)
    if (failure === 'corrupt') await writeFile(path, 'corrupt')
    else {
      await unlink(path)
      if (failure === 'symlink') await symlink(join(directory, 'state.json'), path)
    }
    const executor = new ScriptedStreamingChatExecutor()
    expect(await runtime.sendMessage({ treeId: 'saved', prompt: 'Follow-up', model: model(executor) }, { emit() {} }))
      .toMatchObject({ ok: false, error: { code: 'ATTACHMENT_UNAVAILABLE', message: expect.stringContaining('plot.png') } })
    expect(executor.lastReceivedCommand).toBeUndefined()
    const snapshot = await storage.load('saved')
    if (!snapshot.ok) throw new Error('Missing tree')
    expect(snapshot.value.nodes.map((node) => node.id)).toEqual([first.userNodeId, first.assistantNodeId])
    expect(runtime.hasActiveTurn('saved')).toBe(false)
  })

  it('does not silently replace corrupt JSON or unsafe blob references with an empty history', async () => {
    const { directory, runtime } = await setup()
    await send(runtime, 'Describe', [file])
    const path = join(directory, 'state.json')
    const valid = await readFile(path, 'utf8')
    const state = JSON.parse(valid)
    state.attachments[0].files[0].id = '../../other-file'
    for (const text of ['{bad json', JSON.stringify(state)]) {
      await writeFile(path, text)
      await expect(DesktopConversationStorage.open(directory)).rejects.toThrow('未覆盖历史数据')
      expect(await readFile(path, 'utf8')).toBe(text)
    }
  })

  it('checks aggregate context limits before reading blobs and preserves completed history', async () => {
    const { directory, runtime } = await setup()
    await send(runtime, 'Describe', [file])
    const path = join(directory, 'state.json')
    const state = JSON.parse(await readFile(path, 'utf8'))
    const ref = state.attachments[0].files[0]
    state.attachments[0].files = Array.from({ length: 3 }, () => ({ ...ref, size: 20 * 1024 * 1024 }))
    await writeFile(path, JSON.stringify(state))
    const storage = await DesktopConversationStorage.open(directory)
    const resumed = new ConversationRuntimeService(new ConversationTreeService(storage), undefined, undefined, storage)
    const executor = new ScriptedStreamingChatExecutor()
    expect(await resumed.sendMessage({ treeId: 'saved', prompt: 'Too much context', model: model(executor) }, { emit() {} }))
      .toMatchObject({ ok: false, error: { code: 'CONTEXT_LIMIT_EXCEEDED' } })
    expect(executor.lastReceivedCommand).toBeUndefined()
    expect((await storage.loadForNodes('saved', [])).size).toBe(0)
  })

  it.each(['root', 'child'] as const)('recovers an interrupted %s user turn and removes its associations, not shared blobs', async (kind) => {
    const { directory, storage, runtime } = await setup()
    const completed = kind === 'child' ? await send(runtime, 'Completed', undefined) : undefined
    const executor = new DeferredStreamingChatExecutor()
    const pending = runtime.sendMessage({ treeId: 'saved', prompt: 'Interrupted', attachments: [file], model: model(executor) }, { emit() {} })
    await vi.waitFor(() => expect(executor.lastReceivedCommand).toBeDefined())
    await storage.flush()
    const recovered = await DesktopConversationStorage.open(directory)
    const snapshot = await recovered.load('saved')
    if (completed) {
      expect(snapshot.ok).toBe(true)
      if (snapshot.ok) expect(snapshot.value.nodes).toHaveLength(2)
    } else expect(snapshot.ok).toBe(false)
    const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
    expect(state.attachments).toEqual([])
    expect(await readdir(join(directory, 'blobs'))).toEqual([`${blobId}.bin`])
    // Settle the old test process only; production has already exited at this point.
    executor.emitCancelled()
    await pending
  })

  it('preserves remaining branches when deleting a turn and enforces repository compare-and-swap', async () => {
    const { directory, storage, tree, runtime } = await setup()
    const root = await send(runtime, 'Root', undefined)
    const branch = await send(runtime, 'First file', [file], root.assistantNodeId)
    const sibling = await send(runtime, 'Second file', [file], root.assistantNodeId)
    const snapshot = await tree.getTree('saved')
    if (!snapshot.ok) throw new Error('Missing tree')
    expect(await storage.save(snapshot.value, snapshot.value.version - 1)).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } })
    expect((await tree.deleteNode({ treeId: 'saved', nodeId: branch.userNodeId, expectedVersion: snapshot.value.version, mode: 'subtree' })).ok).toBe(true)
    expect((await storage.loadForNodes('saved', [branch.userNodeId])).size).toBe(0)
    expect((await storage.loadForNodes('saved', [sibling.userNodeId])).get(sibling.userNodeId)).toEqual([file])
    expect(await readdir(join(directory, 'blobs'))).toEqual([`${blobId}.bin`])
  })

  it('restores desktop selection and per-turn rendering mode alongside the stored conversation', async () => {
    const { directory, storage, tree, runtime } = await setup()
    const preferences = new GenerationPreferencesService()
    const updated = preferences.setActiveFormat('html')
    expect(updated.ok).toBe(true)
    const service = new DesktopConversationService('saved', tree, runtime, new MutableConversationModelProvider(model(new ScriptedStreamingChatExecutor())), preferences, storage)
    const events: any[] = []
    expect((await service.startTurn({ prompt: 'Saved HTML turn', attachments: [file], expectedRevision: 0, currentTurnId: null,
      contextSelection: { mode: 'root-path', turnIds: [] } }, { emit: (event) => { events.push(event) } })).ok).toBe(true)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'conversation.snapshot.changed')).toBe(true))
    const firstSnapshot = await service.getSnapshot()
    if (!firstSnapshot.ok || !firstSnapshot.value.currentTurnId) throw new Error('Missing selected turn')
    expect((await service.startTurn({ prompt: 'Second turn', expectedRevision: firstSnapshot.value.revision,
      currentTurnId: firstSnapshot.value.currentTurnId, contextSelection: { mode: 'root-path', turnIds: [] } },
    { emit: (event) => { events.push(event) } })).ok).toBe(true)
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'conversation.snapshot.changed')).toHaveLength(2))
    const secondSnapshot = await service.getSnapshot()
    if (!secondSnapshot.ok) throw new Error('Missing second turn')
    const selectedSnapshot = await service.setCurrentTurn(firstSnapshot.value.currentTurnId, secondSnapshot.value.revision)
    expect(selectedSnapshot.ok).toBe(true)
    await storage.flush()
    const reopened = await DesktopConversationStorage.open(directory)
    const cursors = new InMemoryConversationCursorStore()
    cursors.set('saved', reopened.getSelection('saved')!)
    const resumedTree = new ConversationTreeService(reopened)
    const resumed = new DesktopConversationService('saved', resumedTree, new ConversationRuntimeService(resumedTree, cursors, undefined, reopened), new MutableConversationModelProvider(), undefined, reopened)
    expect(await resumed.getSnapshot()).toEqual(selectedSnapshot)
    expect(firstSnapshot.value.turns[0].declaredOutputFormat).toBe('html')
  })
})
