import { NamedChatAttachmentsSchema, MAX_TOTAL_ATTACHMENT_BYTES, base64ByteLength, type NamedChatAttachment } from 'chat-contracts'

/** Implementations own storage; runtime has no filesystem or provider dependency. */
export interface ConversationAttachmentStore {
  saveAttachments(treeId: string, nodeId: string, attachments: readonly NamedChatAttachment[]): Promise<void>
  loadForNodes(treeId: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, readonly NamedChatAttachment[]>>
  removeAttachments(treeId: string, nodeId: string): Promise<void>
}

export class ConversationAttachmentError extends Error {
  constructor(public readonly code: 'ATTACHMENT_UNAVAILABLE' | 'CONTEXT_LIMIT_EXCEEDED', message: string) { super(message) }
}

export class InMemoryConversationAttachmentStore implements ConversationAttachmentStore {
  private readonly trees = new Map<string, Map<string, NamedChatAttachment[]>>()
  async saveAttachments(treeId: string, nodeId: string, attachments: readonly NamedChatAttachment[]) {
    const files = NamedChatAttachmentsSchema.parse(attachments)
    let nodes = this.trees.get(treeId)
    if (!nodes) { nodes = new Map(); this.trees.set(treeId, nodes) }
    nodes.set(nodeId, files)
  }
  async loadForNodes(treeId: string, nodeIds: readonly string[]) {
    const result = new Map<string, readonly NamedChatAttachment[]>()
    let total = 0
    for (const id of nodeIds) {
      const files = this.trees.get(treeId)?.get(id) ?? []
      total += files.reduce((sum, file) => sum + (file.attachment.source.type === 'base64' ? base64ByteLength(file.attachment.source.data) : 0), 0)
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new ConversationAttachmentError('CONTEXT_LIMIT_EXCEEDED', '所选上下文附件总大小超过 50 MiB，请减少上下文节点')
      if (files.length) result.set(id, structuredClone(files))
    }
    return result
  }
  async removeAttachments(treeId: string, nodeId: string) {
    const nodes = this.trees.get(treeId)
    nodes?.delete(nodeId)
    if (!nodes?.size) this.trees.delete(treeId)
  }
}
