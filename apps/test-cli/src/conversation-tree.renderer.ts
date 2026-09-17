import type {
  ConversationNode,
  ConversationNodeId,
  ConversationTreeSnapshot
} from 'chat-conversation-tree'

export interface RenderTreeOptions {
  contentWidth?: number
  color?: boolean
}

export function renderConversationTree(
  snapshot: ConversationTreeSnapshot,
  currentNodeId: ConversationNodeId,
  options?: RenderTreeOptions
): string {
  if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    return 'Empty tree'
  }

  const contentWidth = options?.contentWidth ?? 40
  const color = options?.color ?? false

  const nodesMap = new Map<ConversationNodeId, ConversationNode>()
  const childrenMap = new Map<ConversationNodeId, ConversationNode[]>()

  for (const node of snapshot.nodes) {
    nodesMap.set(node.id, node)
    childrenMap.set(node.id, [])
  }

  let rootNode: ConversationNode | undefined
  for (const node of snapshot.nodes) {
    if (node.parentId === null) {
      rootNode = node
    } else {
      childrenMap.get(node.parentId)?.push(node)
    }
  }

  if (!rootNode) {
    rootNode = nodesMap.get(snapshot.rootId) ?? snapshot.nodes[0]
  }

  if (!rootNode) {
    return 'Empty tree'
  }

  // Sort siblings by sequence ascending
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.sequence - b.sequence)
  }

  const lines: string[] = []
  lines.push(`tree ${snapshot.treeId}  version=${snapshot.version}  nodes=${snapshot.nodes.length}`)

  function formatContent(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim()
    if (collapsed.length > contentWidth) {
      return `"${collapsed.slice(0, contentWidth)}..."`
    }
    return `"${collapsed}"`
  }

  function formatRole(role: string, isCurrent: boolean): string {
    const letter = role === 'system' ? 'S' : role === 'assistant' ? 'A' : 'U'
    const tag = `[${letter}]${isCurrent ? '*' : ''}`
    if (!color) {
      return tag
    }
    if (isCurrent) {
      return `\x1b[1;32m${tag}\x1b[0m` // bold green for current
    }
    if (role === 'user') {
      return `\x1b[34m${tag}\x1b[0m` // blue for user
    }
    if (role === 'assistant') {
      return `\x1b[36m${tag}\x1b[0m` // cyan for assistant
    }
    return `\x1b[33m${tag}\x1b[0m` // yellow for system
  }

  function formatGeneratedBy(generatedBy?: { providerId: string; modelId: string }): string {
    if (!generatedBy) return ''
    const str = `${generatedBy.providerId}/${generatedBy.modelId}`
    if (color) {
      return `\x1b[90m${str}\x1b[0m  `
    }
    return `${str}  `
  }

  function renderNode(node: ConversationNode, prefix: string, isLastChild: boolean, isRoot: boolean): void {
    const isCurrent = node.id === currentNodeId
    const connector = isRoot ? '└─ ' : isLastChild ? '└─ ' : '├─ '
    const roleTag = formatRole(node.role, isCurrent)
    const genByStr = node.role === 'assistant' ? formatGeneratedBy(node.generatedBy) : ''
    const contentStr = formatContent(node.content)

    const nodeLine = `${prefix}${connector}${roleTag} ${node.id}  ${genByStr}${contentStr}`
    lines.push(nodeLine)

    const nextPrefix = isRoot ? '   ' : prefix + (isLastChild ? '   ' : '│  ')
    const children = childrenMap.get(node.id) ?? []

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childIsLast = i === children.length - 1
      renderNode(child, nextPrefix, childIsLast, false)
    }
  }

  renderNode(rootNode, '', true, true)
  lines.push('')
  lines.push('* = current')

  return lines.join('\n')
}
