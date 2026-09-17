import type { ConversationNode, ConversationNodeDraft } from './domain/conversation-node.js'
import { createTreeError } from './domain/conversation-tree.errors.js'
import type {
  ConversationBranch,
  ConversationTreeDescriptor,
  ConversationTreeSnapshot
} from './domain/conversation-tree.snapshot.js'
import type {
  ConversationNodeId,
  ConversationTreeId,
  ConversationTreeResult
} from './domain/conversation-tree.types.js'
import { systemClock, type Clock } from './ports/clock.port.js'
import { TreeInvariantGuard } from './tree-invariant.guard.js'

export interface CreateConversationTreeInput {
  readonly treeId: ConversationTreeId
  readonly root: ConversationNodeDraft
}

export interface AppendConversationNodeInput {
  readonly parentId: ConversationNodeId
  readonly node: ConversationNodeDraft
}

export interface ForkConversationNodeInput {
  readonly parentId: ConversationNodeId
  readonly node: ConversationNodeDraft
}

export interface ForkResult {
  readonly node: ConversationNode
  readonly branchPointId: ConversationNodeId
  readonly siblingCountAfterCreate: number
  readonly createdActualFork: boolean
}

export type DeleteNodeMode = 'leaf-only' | 'subtree'

export interface DeleteConversationNodeInput {
  readonly nodeId: ConversationNodeId
  readonly mode?: DeleteNodeMode
}

export interface DeleteNodesResult {
  readonly deletedNodeIds: readonly ConversationNodeId[]
  readonly newVersion: number
}

export class ConversationTree {
  private readonly treeId: ConversationTreeId
  private readonly rootId: ConversationNodeId
  private version: number
  private nextSequence: number
  private readonly createdAt: string
  private updatedAt: string
  private readonly nodesMap: Map<ConversationNodeId, ConversationNode>
  private readonly childrenMap: Map<ConversationNodeId, ConversationNodeId[]>

  private constructor(snapshot: ConversationTreeSnapshot) {
    this.treeId = snapshot.treeId
    this.rootId = snapshot.rootId
    this.version = snapshot.version
    this.nextSequence = snapshot.nextSequence
    this.createdAt = snapshot.createdAt
    this.updatedAt = snapshot.updatedAt
    this.nodesMap = new Map<ConversationNodeId, ConversationNode>()
    this.childrenMap = new Map<ConversationNodeId, ConversationNodeId[]>()

    for (const node of snapshot.nodes) {
      this.nodesMap.set(node.id, {
        ...node,
        ...(node.generatedBy ? { generatedBy: { ...node.generatedBy } } : {})
      })
      this.childrenMap.set(node.id, [])
    }

    for (const node of snapshot.nodes) {
      if (node.parentId !== null) {
        const parentChildren = this.childrenMap.get(node.parentId)
        if (parentChildren) {
          parentChildren.push(node.id)
        }
      }
    }

    // Sort children by sequence ascending for deterministic order
    for (const children of this.childrenMap.values()) {
      children.sort((a, b) => {
        const nodeA = this.nodesMap.get(a)!
        const nodeB = this.nodesMap.get(b)!
        return nodeA.sequence - nodeB.sequence
      })
    }
  }

  public static create(
    input: CreateConversationTreeInput,
    clock: Clock = systemClock
  ): ConversationTreeResult<ConversationTree> {
    if (!input.treeId || typeof input.treeId !== 'string' || input.treeId.trim() === '') {
      return {
        ok: false,
        error: createTreeError('TREE_ID_MISMATCH', 'Tree id must be a non-empty string')
      }
    }

    const draftValidation = TreeInvariantGuard.validateDraft(input.root)
    if (!draftValidation.ok) {
      return draftValidation
    }

    const now = clock.now()
    const rootNode: ConversationNode = {
      id: input.root.id,
      treeId: input.treeId,
      parentId: null,
      role: input.root.role,
      content: input.root.content,
      sequence: 0,
      createdAt: now,
      ...(input.root.generatedBy ? { generatedBy: { ...input.root.generatedBy } } : {})
    }

    const snapshot: ConversationTreeSnapshot = {
      schemaVersion: 1,
      treeId: input.treeId,
      rootId: rootNode.id,
      version: 1,
      nextSequence: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [rootNode]
    }

    return ConversationTree.hydrate(snapshot)
  }

  public static hydrate(snapshot: ConversationTreeSnapshot): ConversationTreeResult<ConversationTree> {
    const validationResult = TreeInvariantGuard.validateSnapshot(snapshot)
    if (!validationResult.ok) {
      return validationResult
    }

    return {
      ok: true,
      value: new ConversationTree(snapshot)
    }
  }

  public appendNode(
    input: AppendConversationNodeInput,
    clock: Clock = systemClock
  ): ConversationTreeResult<ConversationNode> {
    const draftValidation = TreeInvariantGuard.validateDraft(input.node)
    if (!draftValidation.ok) {
      return draftValidation
    }

    if (this.nodesMap.has(input.node.id)) {
      return {
        ok: false,
        error: createTreeError('DUPLICATE_NODE_ID', `Node with id "${input.node.id}" already exists in tree`)
      }
    }

    if (!this.nodesMap.has(input.parentId)) {
      return {
        ok: false,
        error: createTreeError('PARENT_NOT_FOUND', `Parent node "${input.parentId}" not found in tree`)
      }
    }

    const now = clock.now()
    const newNode: ConversationNode = {
      id: input.node.id,
      treeId: this.treeId,
      parentId: input.parentId,
      role: input.node.role,
      content: input.node.content,
      sequence: this.nextSequence,
      createdAt: now,
      ...(input.node.generatedBy ? { generatedBy: { ...input.node.generatedBy } } : {})
    }

    // Apply mutation
    this.nodesMap.set(newNode.id, newNode)
    this.childrenMap.set(newNode.id, [])
    const parentChildren = this.childrenMap.get(input.parentId)!
    parentChildren.push(newNode.id)
    parentChildren.sort((a, b) => {
      const nodeA = this.nodesMap.get(a)!
      const nodeB = this.nodesMap.get(b)!
      return nodeA.sequence - nodeB.sequence
    })

    this.nextSequence++
    this.version++
    this.updatedAt = now

    // Defensive invariant check
    const validation = this.validate()
    if (!validation.ok) {
      // Rollback mutation
      this.nodesMap.delete(newNode.id)
      this.childrenMap.delete(newNode.id)
      const idx = parentChildren.indexOf(newNode.id)
      if (idx !== -1) parentChildren.splice(idx, 1)
      this.nextSequence--
      this.version--
      return validation
    }

    return {
      ok: true,
      value: { ...newNode }
    }
  }

  public forkFromNode(
    input: ForkConversationNodeInput,
    clock: Clock = systemClock
  ): ConversationTreeResult<ForkResult> {
    if (!this.nodesMap.has(input.parentId)) {
      return {
        ok: false,
        error: createTreeError('PARENT_NOT_FOUND', `Parent node "${input.parentId}" not found in tree`)
      }
    }

    const priorSiblings = this.childrenMap.get(input.parentId) ?? []
    const createdActualFork = priorSiblings.length >= 1

    const appendResult = this.appendNode({ parentId: input.parentId, node: input.node }, clock)
    if (!appendResult.ok) {
      return appendResult
    }

    const siblingCountAfterCreate = (this.childrenMap.get(input.parentId) ?? []).length

    return {
      ok: true,
      value: {
        node: appendResult.value,
        branchPointId: input.parentId,
        siblingCountAfterCreate,
        createdActualFork
      }
    }
  }

  public deleteNode(
    input: DeleteConversationNodeInput,
    clock: Clock = systemClock
  ): ConversationTreeResult<DeleteNodesResult> {
    if (!this.nodesMap.has(input.nodeId)) {
      return {
        ok: false,
        error: createTreeError('NODE_NOT_FOUND', `Node "${input.nodeId}" not found in tree`)
      }
    }

    if (input.nodeId === this.rootId) {
      return {
        ok: false,
        error: createTreeError(
          'ROOT_DELETE_REQUIRES_TREE_DELETE',
          'Cannot delete root node with deleteNode; use deleteTree to delete the entire tree'
        )
      }
    }

    const mode = input.mode ?? 'leaf-only'
    if (mode !== 'leaf-only' && mode !== 'subtree') {
      return {
        ok: false,
        error: createTreeError(
          'INVALID_DELETE_MODE',
          `Unsupported delete mode: ${String(mode)}`
        )
      }
    }

    const targetChildren = this.childrenMap.get(input.nodeId) ?? []

    if (mode === 'leaf-only' && targetChildren.length > 0) {
      return {
        ok: false,
        error: createTreeError(
          'NODE_HAS_CHILDREN',
          `Cannot delete node "${input.nodeId}" in leaf-only mode because it has ${targetChildren.length} children`
        )
      }
    }

    // Collect nodes to delete in pre-order
    const toDelete: ConversationNodeId[] = []
    const collectDescendants = (currId: ConversationNodeId): void => {
      toDelete.push(currId)
      const children = this.childrenMap.get(currId) ?? []
      for (const childId of children) {
        collectDescendants(childId)
      }
    }
    collectDescendants(input.nodeId)

    // Save backup state for atomic rollback if needed
    const backupNodes = new Map<ConversationNodeId, ConversationNode>()
    for (const delId of toDelete) {
      backupNodes.set(delId, this.nodesMap.get(delId)!)
    }
    const targetNode = this.nodesMap.get(input.nodeId)!
    const parentChildren = this.childrenMap.get(targetNode.parentId!)!
    const targetIndexInParent = parentChildren.indexOf(input.nodeId)

    // Execute deletion
    parentChildren.splice(targetIndexInParent, 1)
    for (const delId of toDelete) {
      this.nodesMap.delete(delId)
      this.childrenMap.delete(delId)
    }

    this.version++
    this.updatedAt = clock.now()

    // Validate resulting tree
    const validation = this.validate()
    if (!validation.ok) {
      // Rollback
      parentChildren.splice(targetIndexInParent, 0, input.nodeId)
      for (const [id, node] of backupNodes) {
        this.nodesMap.set(id, node)
        this.childrenMap.set(id, [])
      }
      for (const [id, node] of backupNodes) {
        if (node.parentId !== null && node.parentId !== targetNode.parentId) {
          this.childrenMap.get(node.parentId)?.push(id)
        }
      }
      this.version--
      return validation
    }

    return {
      ok: true,
      value: {
        deletedNodeIds: toDelete,
        newVersion: this.version
      }
    }
  }

  public getNode(nodeId: ConversationNodeId): ConversationTreeResult<ConversationNode> {
    const node = this.nodesMap.get(nodeId)
    if (!node) {
      return {
        ok: false,
        error: createTreeError('NODE_NOT_FOUND', `Node "${nodeId}" not found in tree`)
      }
    }

    return {
      ok: true,
      value: {
        ...node,
        ...(node.generatedBy ? { generatedBy: { ...node.generatedBy } } : {})
      }
    }
  }

  public hasNode(nodeId: ConversationNodeId): boolean {
    return this.nodesMap.has(nodeId)
  }

  public getChildren(nodeId: ConversationNodeId): ConversationTreeResult<readonly ConversationNode[]> {
    if (!this.nodesMap.has(nodeId)) {
      return {
        ok: false,
        error: createTreeError('NODE_NOT_FOUND', `Node "${nodeId}" not found in tree`)
      }
    }

    const childIds = this.childrenMap.get(nodeId) ?? []
    const children = childIds.map((cid) => {
      const n = this.nodesMap.get(cid)!
      return {
        ...n,
        ...(n.generatedBy ? { generatedBy: { ...n.generatedBy } } : {})
      }
    })

    return {
      ok: true,
      value: children
    }
  }

  public getAncestors(nodeId: ConversationNodeId): ConversationTreeResult<readonly ConversationNode[]> {
    if (!this.nodesMap.has(nodeId)) {
      return {
        ok: false,
        error: createTreeError('NODE_NOT_FOUND', `Node "${nodeId}" not found in tree`)
      }
    }

    const ancestors: ConversationNode[] = []
    let currParentId = this.nodesMap.get(nodeId)!.parentId

    while (currParentId !== null) {
      const parentNode = this.nodesMap.get(currParentId)
      if (parentNode) {
        ancestors.push({
          ...parentNode,
          ...(parentNode.generatedBy ? { generatedBy: { ...parentNode.generatedBy } } : {})
        })
        currParentId = parentNode.parentId
      } else {
        break
      }
    }

    // Return root-first order (sequence ascending)
    ancestors.reverse()

    return {
      ok: true,
      value: ancestors
    }
  }

  public getPathToNode(nodeId: ConversationNodeId): ConversationTreeResult<readonly ConversationNode[]> {
    if (!this.nodesMap.has(nodeId)) {
      return {
        ok: false,
        error: createTreeError('NODE_NOT_FOUND', `Node "${nodeId}" not found in tree`)
      }
    }

    const path: ConversationNode[] = []
    let currId: ConversationNodeId | null = nodeId

    while (currId !== null) {
      const node = this.nodesMap.get(currId)
      if (node) {
        path.push({
          ...node,
          ...(node.generatedBy ? { generatedBy: { ...node.generatedBy } } : {})
        })
        currId = node.parentId
      } else {
        break
      }
    }

    // Return root-first order (sequence ascending)
    path.reverse()

    return {
      ok: true,
      value: path
    }
  }

  public getDescendants(nodeId: ConversationNodeId): ConversationTreeResult<readonly ConversationNode[]> {
    if (!this.nodesMap.has(nodeId)) {
      return {
        ok: false,
        error: createTreeError('NODE_NOT_FOUND', `Node "${nodeId}" not found in tree`)
      }
    }

    const descendants: ConversationNode[] = []
    const collect = (currId: ConversationNodeId): void => {
      const children = this.childrenMap.get(currId) ?? []
      for (const childId of children) {
        const childNode = this.nodesMap.get(childId)!
        descendants.push({
          ...childNode,
          ...(childNode.generatedBy ? { generatedBy: { ...childNode.generatedBy } } : {})
        })
        collect(childId)
      }
    }

    collect(nodeId)
    // Deterministic sort by sequence ascending
    descendants.sort((a, b) => a.sequence - b.sequence)

    return {
      ok: true,
      value: descendants
    }
  }

  public listLeaves(): readonly ConversationNode[] {
    const leaves: ConversationNode[] = []
    for (const node of this.nodesMap.values()) {
      const children = this.childrenMap.get(node.id) ?? []
      if (children.length === 0) {
        leaves.push({
          ...node,
          ...(node.generatedBy ? { generatedBy: { ...node.generatedBy } } : {})
        })
      }
    }

    leaves.sort((a, b) => a.sequence - b.sequence)
    return leaves
  }

  public listBranches(): readonly ConversationBranch[] {
    const leaves = this.listLeaves()
    const branches: ConversationBranch[] = []

    for (const leaf of leaves) {
      const pathResult = this.getPathToNode(leaf.id)
      if (pathResult.ok) {
        branches.push({
          leafNodeId: leaf.id,
          nodeIds: pathResult.value.map((n) => n.id)
        })
      }
    }

    return branches
  }

  public validate(): ConversationTreeResult<void> {
    return TreeInvariantGuard.validateSnapshot(this.toSnapshot())
  }

  public toSnapshot(): ConversationTreeSnapshot {
    const nodes = Array.from(this.nodesMap.values())
      .sort((a, b) => a.sequence - b.sequence)
      .map((n) => ({
        ...n,
        ...(n.generatedBy ? { generatedBy: { ...n.generatedBy } } : {})
      }))

    return {
      schemaVersion: 1,
      treeId: this.treeId,
      rootId: this.rootId,
      version: this.version,
      nextSequence: this.nextSequence,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      nodes
    }
  }

  public toDescriptor(): ConversationTreeDescriptor {
    return {
      treeId: this.treeId,
      rootId: this.rootId,
      version: this.version,
      nodeCount: this.nodesMap.size,
      leafCount: this.listLeaves().length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    }
  }
}
