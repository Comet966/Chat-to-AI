import type {
  ConversationNode,
  ConversationNodeId,
  ConversationTreeSnapshot
} from 'chat-conversation-tree'
import type {
  ConversationSnapshotDto,
  ConversationTurnDto,
  DesktopConversationResult
} from '../../shared/conversation.contract.js'

export interface ConversationTurnNodePair {
  readonly userNodeId: ConversationNodeId
  readonly assistantNodeId: ConversationNodeId
}

export interface ProjectedConversation {
  readonly snapshot: ConversationSnapshotDto
  readonly turnNodePairs: ReadonlyMap<string, ConversationTurnNodePair>
}

function projectionFailure(message: string): DesktopConversationResult<never> {
  return { ok: false, error: { code: 'INTERNAL_ERROR', message } }
}

export function projectConversationTurns(
  tree: ConversationTreeSnapshot,
  currentCoreNodeId: ConversationNodeId | null
): DesktopConversationResult<ProjectedConversation> {
  const nodesById = new Map<string, ConversationNode>()
  for (const node of tree.nodes) {
    if (nodesById.has(node.id)) {
      return projectionFailure('Conversation tree contains duplicate node IDs')
    }
    nodesById.set(node.id, node)
  }

  const turns: ConversationTurnDto[] = []
  const turnNodePairs = new Map<string, ConversationTurnNodePair>()
  const assistants = tree.nodes
    .filter((node) => node.role === 'assistant')
    .sort((left, right) => left.sequence - right.sequence)

  for (const [turnSequence, assistant] of assistants.entries()) {
    if (!assistant.parentId) {
      return projectionFailure('Assistant message cannot be the root of a conversation turn')
    }
    const user = nodesById.get(assistant.parentId)
    if (!user || user.role !== 'user') {
      return projectionFailure('Assistant message must be a direct child of a user message')
    }

    let parentTurnId: string | null = null
    let ancestorId = user.parentId
    const visited = new Set<string>()
    while (ancestorId) {
      if (visited.has(ancestorId)) {
        return projectionFailure('Conversation ancestry contains a cycle')
      }
      visited.add(ancestorId)
      const ancestor = nodesById.get(ancestorId)
      if (!ancestor) {
        return projectionFailure('Conversation ancestry contains a missing node')
      }
      if (ancestor.role === 'assistant') {
        parentTurnId = ancestor.id
        break
      }
      ancestorId = ancestor.parentId
    }

    const turn: ConversationTurnDto = {
      id: assistant.id,
      parentId: parentTurnId,
      question: user.content,
      answer: assistant.content,
      // Core sequence counts individual messages. The desktop DTO counts
      // complete question/answer turns, so expose a stable zero-based ordinal.
      sequence: turnSequence,
      createdAt: assistant.createdAt,
      ...(assistant.generatedBy
        ? {
            providerInfo: {
              provider: assistant.generatedBy.providerId,
              modelId: assistant.generatedBy.modelId
            }
          }
        : {})
    }
    turns.push(turn)
    turnNodePairs.set(turn.id, {
      userNodeId: user.id,
      assistantNodeId: assistant.id
    })
  }

  const turnIds = new Set(turns.map((turn) => turn.id))
  for (const turn of turns) {
    if (turn.parentId && !turnIds.has(turn.parentId)) {
      return projectionFailure('Conversation turn refers to an incomplete parent turn')
    }
  }

  const roots = turns.filter((turn) => turn.parentId === null)
  if (roots.length > 1) {
    return projectionFailure('Conversation projection contains more than one root turn')
  }

  let currentTurnId: string | null = null
  let cursorId = currentCoreNodeId
  const cursorVisited = new Set<string>()
  while (cursorId) {
    if (cursorVisited.has(cursorId)) {
      return projectionFailure('Conversation cursor ancestry contains a cycle')
    }
    cursorVisited.add(cursorId)
    if (turnNodePairs.has(cursorId)) {
      currentTurnId = cursorId
      break
    }
    const cursorNode = nodesById.get(cursorId)
    cursorId = cursorNode?.parentId ?? null
  }

  return {
    ok: true,
    value: {
      snapshot: {
        treeId: tree.treeId,
        revision: tree.version,
        rootTurnId: roots[0]?.id ?? null,
        currentTurnId,
        turns
      },
      turnNodePairs
    }
  }
}
