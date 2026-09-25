import type { ConversationTreeSnapshot } from '../../../ports/conversation-tree-ui.port.js'

export type TreeValidationResult =
  | { valid: true }
  | { valid: false; error: { code: string; message: string; nodeId?: string } }

export function validateTreeSnapshot(snapshot: ConversationTreeSnapshot): TreeValidationResult {
  if (!snapshot || !Array.isArray(snapshot.nodes)) {
    return {
      valid: false,
      error: { code: 'INVALID_SNAPSHOT', message: 'Tree snapshot must contain a nodes array.' }
    }
  }

  if (snapshot.nodes.length === 0) {
    return {
      valid: false,
      error: { code: 'EMPTY_TREE', message: 'Tree must contain at least a root node.' }
    }
  }

  // 1. Check unique IDs
  const idSet = new Set<string>()
  for (const node of snapshot.nodes) {
    if (!node.id) {
      return {
        valid: false,
        error: { code: 'MISSING_NODE_ID', message: 'Node is missing an id.' }
      }
    }
    if (idSet.has(node.id)) {
      return {
        valid: false,
        error: {
          code: 'DUPLICATE_NODE_ID',
          message: `Duplicate node ID "${node.id}" found.`,
          nodeId: node.id
        }
      }
    }
    idSet.add(node.id)
  }

  // 2. Check root node
  const rootNodes = snapshot.nodes.filter((n) => n.parentId === null)
  if (rootNodes.length === 0) {
    return {
      valid: false,
      error: { code: 'NO_ROOT_NODE', message: 'Tree does not have a root node (parentId is null).' }
    }
  }
  if (rootNodes.length > 1) {
    return {
      valid: false,
      error: {
        code: 'MULTIPLE_ROOT_NODES',
        message: `Tree has ${rootNodes.length} root nodes; strictly one root is allowed.`
      }
    }
  }

  const rootNode = rootNodes[0]
  if (snapshot.rootId !== rootNode.id) {
    return {
      valid: false,
      error: {
        code: 'ROOT_ID_MISMATCH',
        message: `Snapshot rootId "${snapshot.rootId}" does not match actual root node "${rootNode.id}".`,
        nodeId: snapshot.rootId
      }
    }
  }

  // 3. Check current node existence
  if (!snapshot.currentNodeId || !idSet.has(snapshot.currentNodeId)) {
    return {
      valid: false,
      error: {
        code: 'CURRENT_NODE_MISSING',
        message: `Current node "${snapshot.currentNodeId}" does not exist in the tree.`,
        nodeId: snapshot.currentNodeId
      }
    }
  }

  // 4. Check parent existence & self-references
  for (const node of snapshot.nodes) {
    if (node.parentId !== null) {
      if (node.id === node.parentId) {
        return {
          valid: false,
          error: {
            code: 'SELF_REFERENCE',
            message: `Node "${node.id}" references itself as parent.`,
            nodeId: node.id
          }
        }
      }
      if (!idSet.has(node.parentId)) {
        return {
          valid: false,
          error: {
            code: 'MISSING_PARENT',
            message: `Node "${node.id}" specifies non-existent parent "${node.parentId}".`,
            nodeId: node.id
          }
        }
      }
    }
  }

  // 5. Check cycle and reachability from root via DFS
  const childrenMap = new Map<string, string[]>()
  for (const node of snapshot.nodes) {
    childrenMap.set(node.id, [])
  }
  for (const node of snapshot.nodes) {
    if (node.parentId !== null) {
      childrenMap.get(node.parentId)?.push(node.id)
    }
  }

  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  const checkCyclesAndTraverse = (nodeId: string): boolean => {
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const children = childrenMap.get(nodeId) ?? []
    for (const childId of children) {
      if (!visited.has(childId)) {
        if (!checkCyclesAndTraverse(childId)) {
          return false
        }
      } else if (recursionStack.has(childId)) {
        return false // Cycle detected
      }
    }

    recursionStack.delete(nodeId)
    return true
  }

  const noCycles = checkCyclesAndTraverse(rootNode.id)
  if (!noCycles) {
    return {
      valid: false,
      error: { code: 'CYCLE_DETECTED', message: 'Cycle detected in tree graph.' }
    }
  }

  // 6. Check that all nodes are reachable from root
  if (visited.size !== snapshot.nodes.length) {
    const unreachable = snapshot.nodes.find((n) => !visited.has(n.id))
    return {
      valid: false,
      error: {
        code: 'UNREACHABLE_NODE',
        message: `Node "${unreachable?.id}" is disconnected and unreachable from root.`,
        nodeId: unreachable?.id
      }
    }
  }

  return { valid: true }
}
