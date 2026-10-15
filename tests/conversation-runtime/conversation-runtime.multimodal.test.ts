import { describe, expect, it, vi } from 'vitest'
import { ConversationRuntimeService, InMemoryConversationAttachmentStore } from 'chat-conversation-runtime'
import { ConversationTreeService, InMemoryConversationTreeRepository } from 'chat-conversation-tree'
import { formatAttachmentPrompt, type NamedChatAttachment } from 'chat-contracts'
import { DeferredStreamingChatExecutor, ScriptedStreamingChatExecutor } from './test-helpers.js'

const file: NamedChatAttachment = {
  name: 'diagram.png', attachment: { type: 'image', mediaType: 'image/png', source: { type: 'base64', data: 'dHJhbnNpZW50LW1lZGlh' } }
}
function setup() {
  const tree = new ConversationTreeService(new InMemoryConversationTreeRepository())
  return { tree, runtime: new ConversationRuntimeService(tree) }
}
const model = (executor: ScriptedStreamingChatExecutor | DeferredStreamingChatExecutor) => ({ providerId: 'test', modelId: 'vision', executor })

describe('contextual conversation attachments', () => {
  it.each(['root-path', 'explicit-nodes'] as const)('keeps tree binary-free and reloads historical media in %s context', async (mode) => {
    const { tree, runtime } = setup()
    const first = new ScriptedStreamingChatExecutor()
    const completed = await runtime.sendMessage({ treeId: 'media', prompt: 'Describe', attachments: [file], model: model(first) }, { emit() {} })
    expect(completed.ok).toBe(true)
    if (!completed.ok) throw new Error('First turn failed')
    expect(first.lastReceivedCommand?.messages.at(-1)).toEqual({ role: 'user', content: formatAttachmentPrompt('Describe', [file]), attachments: [file.attachment] })
    const snapshot = await tree.getTree('media')
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) throw new Error('Missing tree')
    expect(snapshot.value.nodes[0].content).toContain('diagram.png')
    expect(JSON.stringify(snapshot.value)).not.toContain(file.attachment.source.data)
    expect(snapshot.value.nodes.every((node) => !('attachments' in node))).toBe(true)
    const next = new ScriptedStreamingChatExecutor()
    expect((await runtime.sendMessage({ treeId: 'media', prompt: 'Next', model: model(next), contextSelection: mode === 'root-path'
      ? { mode } : { mode, nodeIds: [completed.value.userNodeId, completed.value.assistantNodeId] } }, { emit() {} })).ok).toBe(true)
    expect(next.lastReceivedCommand?.messages[0].content).toContain('diagram.png')
    expect(next.lastReceivedCommand?.messages[0].attachments).toEqual([file.attachment])
    expect(next.lastReceivedCommand?.messages.slice(1).every((message) => !message.attachments)).toBe(true)
  })

  it('attaches only to the new branch prompt, supports file-only input, and snapshots caller media', async () => {
    const { tree, runtime } = setup()
    const first = await runtime.sendMessage({ treeId: 'branch', prompt: 'First', model: model(new ScriptedStreamingChatExecutor()) }, { emit() {} })
    if (!first.ok) throw new Error('First turn failed')
    const executor = new DeferredStreamingChatExecutor()
    const mutable = structuredClone(file)
    const pending = runtime.sendMessage({ treeId: 'branch', selectedNodeId: first.value.assistantNodeId, prompt: '', attachments: [mutable], model: model(executor) }, { emit() {} })
    mutable.name = 'mutated.png'
    mutable.attachment.source.data = 'bXV0YXRlZA=='
    await vi.waitFor(() => expect(executor.lastReceivedCommand).toBeDefined())
    const messages = executor.lastReceivedCommand!.messages
    expect(messages.slice(0, -1).every((message) => !message.attachments)).toBe(true)
    expect(messages.at(-1)?.attachments).toEqual([file.attachment])
    expect(messages.at(-1)?.content).toContain('请分析本轮附件')
    executor.emitDelta('A blue shape')
    executor.emitCompleted()
    expect((await pending).ok).toBe(true)
    const snapshot = await tree.getTree('branch')
    if (!snapshot.ok) throw new Error('Missing tree')
    expect(snapshot.value.nodes[2]).toMatchObject({ parentId: first.value.assistantNodeId })
    expect(snapshot.value.nodes[2].content).toContain('diagram.png')
    expect(JSON.stringify(snapshot.value)).not.toContain(file.attachment.source.data)
  })

  it.each([
    [{ ...file, name: '/private/file.png' }],
    [{ ...file, attachment: { ...file.attachment, source: { type: 'base64', data: 'not-base64' } } }],
    Array.from({ length: 11 }, () => file),
    []
  ].map((attachments) => ({ attachments })))('rejects invalid attachments before creating nodes', async ({ attachments }) => {
    const { tree, runtime } = setup()
    const executor = new ScriptedStreamingChatExecutor()
    expect((await runtime.sendMessage({ treeId: 'invalid', prompt: 'Describe', attachments: attachments as NamedChatAttachment[], model: model(executor) }, { emit() {} })).ok).toBe(false)
    expect((await tree.getTree('invalid')).ok).toBe(false)
    expect(executor.lastReceivedCommand).toBeUndefined()
  })

  it('rolls back attachment-name nodes on provider failure and cancellation', async () => {
    for (const action of [{ type: 'failed' as const, message: 'unsupported model' }, { type: 'cancelled' as const }]) {
      const { tree, runtime } = setup()
      const executor = new ScriptedStreamingChatExecutor([action])
      expect((await runtime.sendMessage({ treeId: 'rollback', prompt: 'Describe', attachments: [file], model: model(executor) }, { emit() {} })).ok).toBe(false)
      expect((await tree.getTree('rollback')).ok).toBe(false)
      expect(runtime.hasActiveTurn('rollback')).toBe(false)
    }
  })

  it('settles failed turns even when attachment reference cleanup fails', async () => {
    class FailingCleanupStore extends InMemoryConversationAttachmentStore {
      async removeAttachments(): Promise<void> { throw new Error('disk unavailable') }
    }
    const tree = new ConversationTreeService(new InMemoryConversationTreeRepository())
    const runtime = new ConversationRuntimeService(tree, undefined, undefined, new FailingCleanupStore())
    const executor = new ScriptedStreamingChatExecutor([{ type: 'failed', message: 'unsupported model' }])
    expect(await runtime.sendMessage({ treeId: 'cleanup', prompt: 'Describe', attachments: [file], model: model(executor) }, { emit() {} }))
      .toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
    expect(runtime.hasActiveTurn('cleanup')).toBe(false)
    expect((await tree.getTree('cleanup')).ok).toBe(false)
  })
})
