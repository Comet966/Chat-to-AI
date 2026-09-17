import type { ConversationNode, ConversationNodeDraft } from './domain/conversation-node.js'
import { createTreeError, type ConversationTreeError } from './domain/conversation-tree.errors.js'
import type { ConversationTreeSnapshot } from './domain/conversation-tree.snapshot.js'
import type { ConversationNodeId, ConversationTreeResult } from './domain/conversation-tree.types.js'

export class TreeInvariantGuard {
  public static validateDraft(draft: ConversationNodeDraft): ConversationTreeResult<void> {
    if (!draft.id || typeof draft.id !== 'string' || draft.id.trim() === '') {
      return {
        ok: false,
        error: createTreeError('DUPLICATE_NODE_ID', 'Node id cannot be empty')
      }
    }

    if (!draft.content || typeof draft.content !== 'string' || draft.content.trim() === '') {
      return {
        ok: false,
        error: createTreeError('INVALID_NODE_CONTENT', 'Node content cannot be empty or whitespace only')
      }
    }

    if (!this.isConversationRole(draft.role)) {
      return {
        ok: false,
        error: createTreeError(
          'INVALID_NODE_ROLE',
          `Unsupported conversation role: ${String(draft.role)}`
        )
      }
    }

    if (draft.generatedBy !== undefined) {
      if (draft.role !== 'assistant') {
        return {
          ok: false,
          error: createTreeError(
            'INVALID_GENERATION_PROVENANCE',
            'Only assistant nodes may carry generation provenance'
          )
        }
      }
      if (
        typeof draft.generatedBy !== 'object' ||
        draft.generatedBy === null ||
        typeof draft.generatedBy.providerId !== 'string' ||
        draft.generatedBy.providerId.trim() === '' ||
        typeof draft.generatedBy.modelId !== 'string' ||
        draft.generatedBy.modelId.trim() === ''
      ) {
        return {
          ok: false,
          error: createTreeError(
            'INVALID_GENERATION_PROVENANCE',
            'Generation provenance must contain non-empty providerId and modelId'
          )
        }
      }
    }

    return { ok: true, value: undefined }
  }

  public static validateSnapshot(snapshot: ConversationTreeSnapshot): ConversationTreeResult<void> {
    if (typeof snapshot !== 'object' || snapshot === null) {
      return {
        ok: false,
        error: createTreeError('INVALID_SNAPSHOT_METADATA', 'Snapshot must be an object')
      }
    }

    if (snapshot.schemaVersion !== 1) {
      return {
        ok: false,
        error: createTreeError(
          'UNSUPPORTED_SNAPSHOT_VERSION',
          `Unsupported schema version: ${String(snapshot.schemaVersion)}`
        )
      }
    }

    if (!snapshot.treeId || typeof snapshot.treeId !== 'string' || snapshot.treeId.trim() === '') {
      return {
        ok: false,
        error: createTreeError('TREE_ID_MISMATCH', 'Tree id must be a non-empty string')
      }
    }

    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      return {
        ok: false,
        error: createTreeError(
          'INVALID_SNAPSHOT_METADATA',
          `Snapshot version must be a positive integer, received ${String(snapshot.version)}`
        )
      }
    }

    if (!Number.isInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) {
      return {
        ok: false,
        error: createTreeError(
          'INVALID_SEQUENCE',
          `Snapshot nextSequence must be a positive integer, received ${String(snapshot.nextSequence)}`
        )
      }
    }

    if (!this.isNonEmptyString(snapshot.createdAt) || !this.isNonEmptyString(snapshot.updatedAt)) {
      return {
        ok: false,
        error: createTreeError(
          'INVALID_SNAPSHOT_METADATA',
          'Snapshot createdAt and updatedAt must be non-empty strings'
        )
      }
    }

    if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
      return {
        ok: false,
        error: createTreeError('INVALID_ROOT_COUNT', 'Tree must contain at least one node')
      }
    }

    // T01 & T02 & T11 & T12: Check node fields, duplicate IDs, content, provenance, treeId match
    const nodeMap = new Map<ConversationNodeId, ConversationNode>()
    for (const node of snapshot.nodes) {
      if (typeof node !== 'object' || node === null) {
        return {
          ok: false,
          error: createTreeError(
            'INVALID_SNAPSHOT_METADATA',
            'Every snapshot node must be an object'
          )
        }
      }

      if (!node.id || typeof node.id !== 'string' || node.id.trim() === '') {
        return {
          ok: false,
          error: createTreeError('DUPLICATE_NODE_ID', 'Node id must be a non-empty string')
        }
      }

      if (nodeMap.has(node.id)) {
        return {
          ok: false,
          error: createTreeError('DUPLICATE_NODE_ID', `Duplicate node id found: "${node.id}"`)
        }
      }
      nodeMap.set(node.id, node)

      if (node.treeId !== snapshot.treeId) {
        return {
          ok: false,
          error: createTreeError(
            'TREE_ID_MISMATCH',
            `Node "${node.id}" treeId "${node.treeId}" does not match snapshot treeId "${snapshot.treeId}"`
          )
        }
      }

      if (node.parentId !== null && !this.isNonEmptyString(node.parentId)) {
        return {
          ok: false,
          error: createTreeError(
            'PARENT_NOT_FOUND',
            `Node "${node.id}" parentId must be null or a non-empty string`
          )
        }
      }

      if (!this.isConversationRole(node.role)) {
        return {
          ok: false,
          error: createTreeError(
            'INVALID_NODE_ROLE',
            `Node "${node.id}" has unsupported role: ${String(node.role)}`
          )
        }
      }

      if (!node.content || typeof node.content !== 'string' || node.content.trim() === '') {
        return {
          ok: false,
          error: createTreeError('INVALID_NODE_CONTENT', `Node "${node.id}" content cannot be empty or whitespace only`)
        }
      }
      if (!this.isNonEmptyString(node.createdAt)) {
        return {
          ok: false,
          error: createTreeError(
            'INVALID_SNAPSHOT_METADATA',
            `Node "${node.id}" createdAt must be a non-empty string`
          )
        }
      }

      if (node.generatedBy !== undefined) {
        if (node.role !== 'assistant') {
          return {
            ok: false,
            error: createTreeError(
              'INVALID_GENERATION_PROVENANCE',
              `Node "${node.id}" with role "${node.role}" cannot carry generation provenance`
            )
          }
        }
        if (
          typeof node.generatedBy !== 'object' ||
          node.generatedBy === null ||
          typeof node.generatedBy.providerId !== 'string' ||
          node.generatedBy.providerId.trim() === '' ||
          typeof node.generatedBy.modelId !== 'string' ||
          node.generatedBy.modelId.trim() === ''
        ) {
          return {
            ok: false,
            error: createTreeError(
              'INVALID_GENERATION_PROVENANCE',
              `Node "${node.id}" generation provenance must contain non-empty providerId and modelId`
            )
          }
        }
      }
    }

    // T07: Cycle detection (inspecting parent pointer chains from every node)
    const cycleCheckResult = this.detectCycles(snapshot.nodes, nodeMap)
    if (!cycleCheckResult.ok) {
      return cycleCheckResult
    }

    // T05: Every non-root node's parent must exist in the snapshot
    for (const node of snapshot.nodes) {
      if (node.parentId !== null && !nodeMap.has(node.parentId)) {
        return {
          ok: false,
          error: createTreeError(
            'PARENT_NOT_FOUND',
            `Parent node "${node.parentId}" of node "${node.id}" not found in snapshot`
          )
        }
      }
    }

    // T03: Exactly one root node with parentId === null
    const rootNodes = snapshot.nodes.filter((n) => n.parentId === null)
    if (rootNodes.length !== 1) {
      return {
        ok: false,
        error: createTreeError(
          'INVALID_ROOT_COUNT',
          `Tree must have exactly one root node, found ${rootNodes.length}`
        )
      }
    }

    // T04: snapshot.rootId must point to the unique root node
    const rootNode = rootNodes[0]
    if (rootNode.id !== snapshot.rootId) {
      return {
        ok: false,
        error: createTreeError(
          'ROOT_ID_MISMATCH',
          `Snapshot rootId "${snapshot.rootId}" does not match actual root node id "${rootNode.id}"`
        )
      }
    }

    // T10: Sequence checks (unique, non-negative, parent.sequence < child.sequence, sequence < nextSequence)
    const sequenceSet = new Set<number>()
    for (const node of snapshot.nodes) {
      if (!Number.isInteger(node.sequence) || node.sequence < 0) {
        return {
          ok: false,
          error: createTreeError('INVALID_SEQUENCE', `Node "${node.id}" has invalid sequence ${node.sequence}`)
        }
      }

      if (sequenceSet.has(node.sequence)) {
        return {
          ok: false,
          error: createTreeError('INVALID_SEQUENCE', `Duplicate sequence ${node.sequence} found at node "${node.id}"`)
        }
      }
      sequenceSet.add(node.sequence)

      if (node.sequence >= snapshot.nextSequence) {
        return {
          ok: false,
          error: createTreeError(
            'INVALID_SEQUENCE',
            `Node "${node.id}" sequence ${node.sequence} must be less than nextSequence ${snapshot.nextSequence}`
          )
        }
      }

      if (node.parentId !== null) {
        const parent = nodeMap.get(node.parentId)
        if (parent && parent.sequence >= node.sequence) {
          return {
            ok: false,
            error: createTreeError(
              'INVALID_SEQUENCE',
              `Parent "${parent.id}" sequence ${parent.sequence} must be strictly less than child "${node.id}" sequence ${node.sequence}`
            )
          }
        }
      }
    }

    // T06: Reachability from root (no disconnected subgraphs)
    const childrenMap = new Map<ConversationNodeId, ConversationNodeId[]>()
    for (const node of snapshot.nodes) {
      childrenMap.set(node.id, [])
    }
    for (const node of snapshot.nodes) {
      if (node.parentId !== null) {
        childrenMap.get(node.parentId)?.push(node.id)
      }
    }

    const reachable = new Set<ConversationNodeId>()
    const dfs = (currId: ConversationNodeId): void => {
      reachable.add(currId)
      const children = childrenMap.get(currId) ?? []
      for (const childId of children) {
        if (!reachable.has(childId)) {
          dfs(childId)
        }
      }
    }
    dfs(rootNode.id)

    if (reachable.size !== snapshot.nodes.length) {
      return {
        ok: false,
        error: createTreeError(
          'DISCONNECTED_NODE',
          `Disconnected nodes found in tree. Reachable: ${reachable.size}, total: ${snapshot.nodes.length}`
        )
      }
    }

    return { ok: true, value: undefined }
  }

  private static isConversationRole(role: unknown): role is ConversationNode['role'] {
    return role === 'system' || role === 'user' || role === 'assistant'
  }

  private static isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
  }

  private static detectCycles(
    nodes: readonly ConversationNode[],
    nodeMap: Map<ConversationNodeId, ConversationNode>
  ): ConversationTreeResult<void> {
    // Check for parent link cycles from each node
    for (const startNode of nodes) {
      const visitedInChain = new Set<ConversationNodeId>()
      let curr: ConversationNode | undefined = startNode

      while (curr) {
        if (curr.parentId === curr.id) {
          return {
            ok: false,
            error: createTreeError('CYCLE_DETECTED', `Self-cycle detected at node "${curr.id}"`)
          }
        }

        if (visitedInChain.has(curr.id)) {
          return {
            ok: false,
            error: createTreeError('CYCLE_DETECTED', `Cycle detected involving node "${curr.id}"`)
          }
        }

        visitedInChain.add(curr.id)
        if (curr.parentId === null) {
          break
        }
        curr = nodeMap.get(curr.parentId)
      }
    }

    return { ok: true, value: undefined }
  }
}
