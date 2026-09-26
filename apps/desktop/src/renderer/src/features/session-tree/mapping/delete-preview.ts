import type {
  ConversationTreeDeleteMode,
  ConversationTreeSnapshot
} from '../../../ports/conversation-tree-ui.port.js'

export interface ConversationTreeDeletePreview {
  normalizedNodeIds: string[]
  affectedNodeIds: string[]
  nonLeafNodeIds: string[]
}

/**
 * Derives a delete preview from a snapshot without modifying it. When an
 * ancestor and one of its descendants are selected, only the ancestor is an
 * operation root; this makes bulk deletion deterministic.
 */
export function getConversationTreeDeletePreview(
  snapshot: ConversationTreeSnapshot,
  requestedNodeIds: string[],
  mode: ConversationTreeDeleteMode
): ConversationTreeDeletePreview {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const requested = [...new Set(requestedNodeIds)].filter(
    (id) => id !== snapshot.rootId && nodeById.has(id)
  )
  const requestedSet = new Set(requested)

  const normalizedNodeIds = requested.filter((id) => {
    let parentId = nodeById.get(id)?.parentId
    while (parentId) {
      if (requestedSet.has(parentId)) return false
      parentId = nodeById.get(parentId)?.parentId
    }
    return true
  })

  const childrenByParent = new Map<string, string[]>()
  for (const node of snapshot.nodes) {
    if (!node.parentId) continue
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node.id)
    childrenByParent.set(node.parentId, children)
  }

  const nonLeafNodeIds = normalizedNodeIds.filter(
    (id) => (childrenByParent.get(id)?.length ?? 0) > 0
  )

  if (mode === 'leaf-only') {
    return {
      normalizedNodeIds,
      affectedNodeIds: nonLeafNodeIds.length === 0 ? normalizedNodeIds : [],
      nonLeafNodeIds
    }
  }

  const affected = new Set<string>()
  const visit = (id: string) => {
    if (affected.has(id)) return
    affected.add(id)
    for (const childId of childrenByParent.get(id) ?? []) visit(childId)
  }
  for (const id of normalizedNodeIds) visit(id)

  return {
    normalizedNodeIds,
    affectedNodeIds: [...affected],
    nonLeafNodeIds: []
  }
}
