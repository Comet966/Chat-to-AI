import type {
  AddChildNodeInput,
  ConversationTreeNodeDto,
  ConversationTreeResult,
  ConversationTreeSnapshot,
  ConversationTreeUiPort,
  DeleteNodesInput
} from '../ports/conversation-tree-ui.port.js'

export const DEFAULT_DEMO_TREE_NODES: ConversationTreeNodeDto[] = [
  {
    id: 'node-root',
    parentId: null,
    question: '什么是多轮会话树？',
    answer: '多轮会话树以树形结构保存每一轮问答，使同一轮对话可以继续产生多个分支。',
    sequence: 0,
    createdAt: '2026-09-25T00:00:00.000Z'
  },
  {
    id: 'node-u1',
    parentId: 'node-root',
    question: '会话树怎样保存上下文？',
    answer: '默认从根节点沿父子关系读取到当前节点，从而形成连续的上下文路径。',
    sequence: 1,
    createdAt: '2026-09-25T00:01:00.000Z'
  },
  {
    id: 'node-a1',
    parentId: 'node-u1',
    question: '切换模型后还能继续同一条会话吗？',
    answer: '可以。树节点只描述问答内容，模型与协议作为本轮元数据保存，不影响树的拓扑。',
    sequence: 2,
    createdAt: '2026-09-25T00:02:00.000Z',
    providerInfo: { provider: 'openai-compatible', modelId: 'gpt-4o' }
  },
  {
    id: 'node-u2',
    parentId: 'node-a1',
    question: '删除中间分支时怎样保护树结构？',
    answer: '采用显式的子树删除或叶节点删除，并在操作前校验根节点、父节点和当前节点约束。',
    sequence: 3,
    createdAt: '2026-09-25T00:03:00.000Z'
  },
  {
    id: 'node-a2-b1',
    parentId: 'node-u2',
    question: '如何验证子树删除没有留下孤儿节点？',
    answer: '删除完成后重新校验所有剩余节点的 parentId，并确认它们最终都能追溯到唯一根节点。',
    sequence: 4,
    createdAt: '2026-09-25T00:04:00.000Z',
    providerInfo: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' }
  },
  {
    id: 'node-a2-b2',
    parentId: 'node-u2',
    question: '是否可以保留后代并重新挂载？',
    answer: '可以设计重挂载策略，但必须作为独立操作明确暴露，不能混入普通删除语义。',
    sequence: 5,
    createdAt: '2026-09-25T00:05:00.000Z',
    providerInfo: { provider: 'gemini', modelId: 'gemini-1.5-pro' }
  }
]

export const DEFAULT_DEMO_TREE_SNAPSHOT: ConversationTreeSnapshot = {
  treeId: 'tree-demo-default',
  revision: 1,
  rootId: 'node-root',
  currentNodeId: 'node-a2-b1',
  nodes: DEFAULT_DEMO_TREE_NODES
}

export class DemoConversationTreeUiAdapter implements ConversationTreeUiPort {
  private snapshot: ConversationTreeSnapshot
  private listeners = new Set<(snapshot: ConversationTreeSnapshot) => void>()
  private nodeCounter = 100

  constructor(initialSnapshot?: ConversationTreeSnapshot) {
    this.snapshot = initialSnapshot
      ? this.cloneSnapshot(initialSnapshot)
      : this.cloneSnapshot(DEFAULT_DEMO_TREE_SNAPSHOT)
  }

  public async getSnapshot(): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return { ok: true, value: this.cloneSnapshot(this.snapshot) }
  }

  public subscribe(listener: (snapshot: ConversationTreeSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public async setCurrentNode(nodeId: string): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const target = this.snapshot.nodes.find((n) => n.id === nodeId)
    if (!target) {
      return {
        ok: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Node "${nodeId}" does not exist in the conversation tree.`,
          nodeId
        }
      }
    }

    await this.simulateOperation()
    this.snapshot.currentNodeId = nodeId
    this.snapshot.revision++
    const updated = this.cloneSnapshot(this.snapshot)
    this.notify(updated)
    return { ok: true, value: updated }
  }

  public async addChildNode(
    input: AddChildNodeInput
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const parent = this.snapshot.nodes.find((n) => n.id === input.parentId)
    if (!parent) {
      return {
        ok: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Parent node "${input.parentId}" does not exist.`,
          nodeId: input.parentId
        }
      }
    }

    if (
      !input.question ||
      input.question.trim() === '' ||
      !input.answer ||
      input.answer.trim() === ''
    ) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Turn question and answer cannot be empty.'
        }
      }
    }

    await this.simulateOperation()
    this.nodeCounter++
    const maxSeq = this.snapshot.nodes.reduce((max, n) => Math.max(max, n.sequence), 0)
    const newNode: ConversationTreeNodeDto = {
      id: `node-demo-${this.nodeCounter}`,
      parentId: input.parentId,
      question: input.question.trim(),
      answer: input.answer.trim(),
      sequence: maxSeq + 1,
      createdAt: new Date().toISOString(),
      providerInfo: input.providerInfo
    }

    this.snapshot.nodes.push(newNode)
    this.snapshot.currentNodeId = newNode.id
    this.snapshot.revision++
    const updated = this.cloneSnapshot(this.snapshot)
    this.notify(updated)
    return { ok: true, value: updated }
  }

  public async deleteNodes(
    input: DeleteNodesInput
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    if (!input.nodeIds || input.nodeIds.length === 0) {
      return { ok: true, value: this.cloneSnapshot(this.snapshot) }
    }

    if (input.mode !== 'leaf-only' && input.mode !== 'subtree') {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'A valid delete mode is required.' }
      }
    }

    const uniqueNodeIds = [...new Set(input.nodeIds)]
    for (const nodeId of uniqueNodeIds) {
      if (!this.snapshot.nodes.some((node) => node.id === nodeId)) {
        return {
          ok: false,
          error: { code: 'NODE_NOT_FOUND', message: `Node "${nodeId}" does not exist.`, nodeId }
        }
      }
    }

    if (uniqueNodeIds.includes(this.snapshot.rootId)) {
      return {
        ok: false,
        error: {
          code: 'ROOT_NODE_PROTECTED',
          message: 'The root node is protected and cannot be deleted.',
          nodeId: this.snapshot.rootId
        }
      }
    }

    const childrenByParent = new Map<string, string[]>()
    for (const node of this.snapshot.nodes) {
      if (!node.parentId) continue
      const children = childrenByParent.get(node.parentId) ?? []
      children.push(node.id)
      childrenByParent.set(node.parentId, children)
    }

    const nodeById = new Map(this.snapshot.nodes.map((node) => [node.id, node]))
    const selectedNodeIds = new Set(uniqueNodeIds)
    const operationRoots = uniqueNodeIds.filter((nodeId) => {
      let parentId = nodeById.get(nodeId)?.parentId
      while (parentId) {
        if (selectedNodeIds.has(parentId)) return false
        parentId = nodeById.get(parentId)?.parentId
      }
      return true
    })

    if (input.mode === 'leaf-only') {
      const nonLeafNodeId = operationRoots.find(
        (nodeId) => (childrenByParent.get(nodeId)?.length ?? 0) > 0
      )
      if (nonLeafNodeId) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Leaf-only deletion can only delete nodes without children.',
            nodeId: nonLeafNodeId
          }
        }
      }
    }

    // Collect the operation roots and, for subtree mode, all descendants.
    const toDeleteSet = new Set<string>()
    const collectDescendants = (nodeId: string) => {
      toDeleteSet.add(nodeId)
      if (input.mode === 'subtree') {
        for (const childId of childrenByParent.get(nodeId) ?? []) {
          collectDescendants(childId)
        }
      }
    }

    for (const id of operationRoots) {
      collectDescendants(id)
    }

    if (toDeleteSet.has(this.snapshot.rootId)) {
      return {
        ok: false,
        error: {
          code: 'ROOT_NODE_PROTECTED',
          message: 'The root node is protected and cannot be deleted.',
          nodeId: this.snapshot.rootId
        }
      }
    }

    // Determine new current node if current node is deleted
    let newCurrentId = this.snapshot.currentNodeId
    if (toDeleteSet.has(newCurrentId)) {
      // Find the lowest surviving ancestor
      let ancestor: ConversationTreeNodeDto | undefined = this.snapshot.nodes.find(
        (n) => n.id === newCurrentId
      )
      while (ancestor && ancestor.parentId) {
        ancestor = this.snapshot.nodes.find((n) => n.id === ancestor?.parentId)
        if (ancestor && !toDeleteSet.has(ancestor.id)) {
          newCurrentId = ancestor.id
          break
        }
      }
      if (toDeleteSet.has(newCurrentId)) {
        newCurrentId = this.snapshot.rootId
      }
    }

    await this.simulateOperation()
    this.snapshot.nodes = this.snapshot.nodes.filter((n) => !toDeleteSet.has(n.id))
    this.snapshot.currentNodeId = newCurrentId
    this.snapshot.revision++

    const updated = this.cloneSnapshot(this.snapshot)
    this.notify(updated)
    return { ok: true, value: updated }
  }

  public async reload(): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return { ok: true, value: this.cloneSnapshot(this.snapshot) }
  }

  private notify(snapshot: ConversationTreeSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // Safe emission
      }
    }
  }

  private cloneSnapshot(snap: ConversationTreeSnapshot): ConversationTreeSnapshot {
    return {
      treeId: snap.treeId,
      revision: snap.revision,
      rootId: snap.rootId,
      currentNodeId: snap.currentNodeId,
      nodes: snap.nodes.map((n) => ({
        ...n,
        providerInfo: n.providerInfo ? { ...n.providerInfo } : undefined
      }))
    }
  }

  private async simulateOperation(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60)
    })
  }
}
