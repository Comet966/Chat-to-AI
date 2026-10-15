import { constants } from 'node:fs'
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { ConversationTree, type ConversationTreeRepository, type ConversationTreeSnapshot, type ConversationTreeResult } from 'chat-conversation-tree'
import { ConversationAttachmentError, type ConversationAttachmentStore } from 'chat-conversation-runtime'
import { AttachmentNameSchema, NamedChatAttachmentsSchema, ChatAttachmentSchema, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, type NamedChatAttachment } from 'chat-contracts'
import type { TurnFormatMetadata } from '../conversation/conversation-turn.projector.js'

const Id = z.string().min(1).max(256)
const BlobRefSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), name: AttachmentNameSchema,
  type: z.enum(['image', 'document', 'audio']),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'audio/wav', 'audio/mpeg']),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  detail: z.enum(['auto', 'low', 'high']).optional()
}).strict().refine((ref) => ref.type === 'image' ? ref.mediaType.startsWith('image/')
  : ref.type === 'document' ? ref.mediaType === 'application/pdf' : ref.mediaType.startsWith('audio/'))
const SnapshotSchema = z.object({
  schemaVersion: z.literal(1), treeId: Id, rootId: Id, version: z.number().int().positive(),
  nextSequence: z.number().int().positive(), createdAt: z.string().max(128), updatedAt: z.string().max(128),
  nodes: z.array(z.object({
    id: Id, treeId: Id, parentId: Id.nullable(), role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(100000), sequence: z.number().int().nonnegative(), createdAt: z.string().max(128),
    generatedBy: z.object({ providerId: Id, modelId: Id }).strict().optional()
  }).strict()).max(2000)
}).strict()
const StateSchema = z.object({
  schemaVersion: z.literal(1), trees: z.array(SnapshotSchema).max(100),
  attachments: z.array(z.object({ treeId: Id, nodeId: Id, files: z.array(BlobRefSchema).min(1).max(10) }).strict()).max(10000),
  selections: z.array(z.object({ treeId: Id, nodeId: Id }).strict()).max(100),
  formats: z.array(z.object({ turnId: Id, declaredOutputFormat: z.enum(['markdown', 'html']), templateVersion: z.number().int().positive() }).strict()).max(10000)
}).strict()
type State = z.infer<typeof StateSchema>
const emptyState = (): State => ({ schemaVersion: 1, trees: [], attachments: [], selections: [], formats: [] })
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const treeError = (code: 'TREE_NOT_FOUND' | 'TREE_ALREADY_EXISTS' | 'VERSION_CONFLICT' | 'INVALID_SNAPSHOT_METADATA'): ConversationTreeResult<never> =>
  ({ ok: false, error: { code, message: code === 'INVALID_SNAPSHOT_METADATA' ? '本地会话存储不可用，请检查磁盘或备份' : code } })

/** Desktop-only repository + attachment adapter. Binary data never enters tree JSON or IPC snapshots. */
export class DesktopConversationStorage implements ConversationTreeRepository, ConversationAttachmentStore {
  private state: State = emptyState()
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<DesktopConversationStorage> {
    const storage = new DesktopConversationStorage(directory)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await mkdir(join(directory, 'blobs'), { recursive: true, mode: 0o700 })
    for (const path of [directory, join(directory, 'blobs')]) {
      const stat = await lstat(path)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe conversation storage directory')
    }
    let bytes: Buffer
    try { bytes = await storage.readBounded(join(directory, 'state.json'), 128 * 1024 * 1024) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return storage
      throw new Error('本地会话文件不可读；已保留原文件，未覆盖历史数据')
    }
    try {
      storage.state = StateSchema.parse(JSON.parse(bytes.toString('utf8')))
      const keys = new Set<string>()
      for (const snapshot of storage.state.trees) {
        if (keys.has(snapshot.treeId) || !ConversationTree.hydrate(snapshot).ok) throw new Error('Invalid tree state')
        keys.add(snapshot.treeId)
      }
      const associations = new Set<string>()
      for (const row of storage.state.attachments) {
        const key = JSON.stringify([row.treeId, row.nodeId])
        if (associations.has(key) || !storage.state.trees.find((tree) => tree.treeId === row.treeId)?.nodes.some((node) => node.id === row.nodeId && node.role === 'user')) {
          throw new Error('Invalid attachment association')
        }
        associations.add(key)
      }
      await storage.recoverInterruptedTurns()
    } catch {
      throw new Error('本地会话文件损坏或不可读；已保留原文件，未覆盖历史数据')
    }
    return storage
  }

  private async readBounded(path: string, limit: number): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > limit) throw new Error('File exceeds limit')
      // Bound allocation even if the file grows between stat and read.
      const bytes = Buffer.alloc(stat.size + 1)
      let length = 0
      while (length < bytes.length) {
        const part = await file.read(bytes, length, bytes.length - length, null)
        if (!part.bytesRead) break
        length += part.bytesRead
      }
      if (length > stat.size || length > limit) throw new Error('File changed or exceeds limit')
      return bytes.subarray(0, length)
    } finally { await file.close() }
  }

  private async writeAtomic(path: string, bytes: Buffer): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      try { await file.writeFile(bytes); await file.sync() }
      finally { await file.close() }
      await rename(temporary, path)
    }
    catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }

  private mutate<T>(update: (next: State) => Promise<T> | T): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state)
      const result = await update(next)
      StateSchema.parse(next)
      await this.writeAtomic(join(this.directory, 'state.json'), Buffer.from(JSON.stringify(next)))
      this.state = next
      return result
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  async flush(): Promise<void> { await this.queue }

  private prune(next: State): void {
    const users = new Set(next.trees.flatMap((tree) => tree.nodes.filter((node) => node.role === 'user').map((node) => JSON.stringify([tree.treeId, node.id]))))
    const assistants = new Set(next.trees.flatMap((tree) => tree.nodes.filter((node) => node.role === 'assistant').map((node) => node.id)))
    next.attachments = next.attachments.filter((row) => users.has(JSON.stringify([row.treeId, row.nodeId])))
    next.formats = next.formats.filter((row) => assistants.has(row.turnId))
    next.selections = next.selections.filter((row) => next.trees.some((tree) => tree.treeId === row.treeId && tree.nodes.some((node) => node.id === row.nodeId)))
  }

  private async recoverInterruptedTurns(): Promise<void> {
    await this.mutate((next) => {
      const trees: State['trees'] = []
      for (const snapshot of next.trees) {
        const hydrated = ConversationTree.hydrate(snapshot)
        if (!hydrated.ok) throw new Error('Invalid tree')
        const tree = hydrated.value
        let discard = false
        for (const leaf of tree.listLeaves().filter((node) => node.role === 'user')) {
          if (leaf.id === snapshot.rootId) { discard = true; break }
          const removed = tree.deleteNode({ nodeId: leaf.id, mode: 'leaf-only' }, { now: () => new Date().toISOString() })
          if (!removed.ok) throw new Error('Failed to recover incomplete turn')
        }
        if (!discard) trees.push(structuredClone(tree.toSnapshot()) as State['trees'][number])
      }
      next.trees = trees
      this.prune(next)
    })
  }

  async create(snapshot: ConversationTreeSnapshot): Promise<ConversationTreeResult<void>> {
    const copied = structuredClone(snapshot)
    try { return await this.mutate((next) => {
      if (next.trees.some((tree) => tree.treeId === copied.treeId)) return treeError('TREE_ALREADY_EXISTS')
      if (!ConversationTree.hydrate(copied).ok) return treeError('INVALID_SNAPSHOT_METADATA')
      next.trees.push(SnapshotSchema.parse(copied))
      return { ok: true as const, value: undefined }
    }) } catch { return treeError('INVALID_SNAPSHOT_METADATA') }
  }
  async load(treeId: string): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    await this.queue
    const snapshot = this.state.trees.find((tree) => tree.treeId === treeId)
    return snapshot ? { ok: true, value: structuredClone(snapshot) } : treeError('TREE_NOT_FOUND')
  }
  async save(snapshot: ConversationTreeSnapshot, expectedVersion: number): Promise<ConversationTreeResult<void>> {
    const copied = structuredClone(snapshot)
    try { return await this.mutate((next) => {
      const index = next.trees.findIndex((tree) => tree.treeId === copied.treeId)
      if (index < 0) return treeError('TREE_NOT_FOUND')
      if (next.trees[index].version !== expectedVersion) return treeError('VERSION_CONFLICT')
      if (!ConversationTree.hydrate(copied).ok) return treeError('INVALID_SNAPSHOT_METADATA')
      next.trees[index] = SnapshotSchema.parse(copied)
      this.prune(next)
      return { ok: true as const, value: undefined }
    }) } catch { return treeError('INVALID_SNAPSHOT_METADATA') }
  }
  async delete(treeId: string, expectedVersion: number): Promise<ConversationTreeResult<void>> {
    try { return await this.mutate((next) => {
      const tree = next.trees.find((candidate) => candidate.treeId === treeId)
      if (!tree) return treeError('TREE_NOT_FOUND')
      if (tree.version !== expectedVersion) return treeError('VERSION_CONFLICT')
      next.trees = next.trees.filter((candidate) => candidate.treeId !== treeId)
      this.prune(next)
      return { ok: true as const, value: undefined }
    }) } catch { return treeError('INVALID_SNAPSHOT_METADATA') }
  }
  async list() {
    await this.queue
    return { ok: true as const, value: this.state.trees.map((snapshot) => {
      const tree = ConversationTree.hydrate(snapshot)
      if (!tree.ok) throw new Error('Invalid tree')
      return tree.value.toDescriptor()
    }) }
  }

  async saveAttachments(treeId: string, nodeId: string, input: readonly NamedChatAttachment[]): Promise<void> {
    const attachments = NamedChatAttachmentsSchema.parse(input)
    await this.mutate(async (next) => {
      if (!next.trees.find((tree) => tree.treeId === treeId)?.nodes.some((node) => node.id === nodeId && node.role === 'user')) {
        throw new ConversationAttachmentError('ATTACHMENT_UNAVAILABLE', '无法将附件关联到当前消息')
      }
      const files: z.infer<typeof BlobRefSchema>[] = []
      for (const item of attachments) {
        if (item.attachment.source.type !== 'base64') throw new ConversationAttachmentError('ATTACHMENT_UNAVAILABLE', '请上传本地附件；桌面存储不自动下载外链')
        const bytes = Buffer.from(item.attachment.source.data, 'base64')
        const id = hash(bytes)
        const path = join(this.directory, 'blobs', `${id}.bin`)
        try {
          const existing = await this.readBounded(path, MAX_ATTACHMENT_BYTES)
          if (hash(existing) !== id) throw new Error('Corrupt blob')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ConversationAttachmentError('ATTACHMENT_UNAVAILABLE', `附件「${item.name}」的本地副本损坏，未覆盖原文件`)
          await this.writeAtomic(path, bytes)
        }
        files.push({ id, name: item.name, type: item.attachment.type, mediaType: item.attachment.mediaType, size: bytes.length,
          ...(item.attachment.type === 'image' && item.attachment.detail ? { detail: item.attachment.detail } : {}) })
      }
      next.attachments = next.attachments.filter((row) => row.treeId !== treeId || row.nodeId !== nodeId)
      next.attachments.push({ treeId, nodeId, files })
    })
  }

  async loadForNodes(treeId: string, nodeIds: readonly string[]) {
    await this.queue
    const rows = nodeIds.map((nodeId) => this.state.attachments.find((row) => row.treeId === treeId && row.nodeId === nodeId))
    // Context ceiling is separate from saved-file size; check before reading all blobs.
    const total = rows.reduce((sum, row) => sum + (row?.files.reduce((bytes, ref) => bytes + ref.size, 0) ?? 0), 0)
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new ConversationAttachmentError('CONTEXT_LIMIT_EXCEEDED', '所选上下文附件总大小超过 50 MiB，请减少上下文节点')
    const result = new Map<string, readonly NamedChatAttachment[]>()
    for (const row of rows) {
      if (!row) continue
      const files: NamedChatAttachment[] = []
      for (const ref of row.files) {
        try {
          const bytes = await this.readBounded(join(this.directory, 'blobs', `${ref.id}.bin`), ref.size)
          if (bytes.length !== ref.size || hash(bytes) !== ref.id) throw new Error('Corrupt blob')
          const attachment = ChatAttachmentSchema.parse({
            type: ref.type, mediaType: ref.mediaType, source: { type: 'base64', data: bytes.toString('base64') },
            ...(ref.type === 'document' ? { filename: ref.name } : {}),
            ...(ref.type === 'image' && ref.detail ? { detail: ref.detail } : {})
          })
          files.push({ name: ref.name, attachment })
        } catch { throw new ConversationAttachmentError('ATTACHMENT_UNAVAILABLE', `附件「${ref.name}」缺失或损坏，请重新上传，或将该轮排除在上下文之外`) }
      }
      result.set(row.nodeId, files)
    }
    return result
  }
  async removeAttachments(treeId: string, nodeId: string) {
    await this.queue
    if (!this.state.attachments.some((row) => row.treeId === treeId && row.nodeId === nodeId)) return
    await this.mutate((next) => { next.attachments = next.attachments.filter((row) => row.treeId !== treeId || row.nodeId !== nodeId) })
    // Shared blobs are retained; reference deletion must not break other branches.
  }

  getSelection(treeId: string): string | undefined { return this.state.selections.find((row) => row.treeId === treeId)?.nodeId }
  async saveSelection(treeId: string, nodeId: string): Promise<void> {
    await this.mutate((next) => {
      next.selections = next.selections.filter((row) => row.treeId !== treeId)
      next.selections.push({ treeId, nodeId })
      this.prune(next)
    })
  }
  getFormats(): ReadonlyMap<string, TurnFormatMetadata> {
    return new Map(this.state.formats.map((row) => [row.turnId, { declaredOutputFormat: row.declaredOutputFormat, templateVersion: row.templateVersion }]))
  }
  async saveFormat(treeId: string, turnId: string, format: TurnFormatMetadata): Promise<void> {
    await this.mutate((next) => {
      next.formats = next.formats.filter((row) => row.turnId !== turnId)
      next.formats.push({ turnId, ...format })
      next.selections = next.selections.filter((row) => row.treeId !== treeId)
      next.selections.push({ treeId, nodeId: turnId })
      this.prune(next)
    })
  }
}
