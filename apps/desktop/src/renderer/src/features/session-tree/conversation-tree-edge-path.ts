export interface ConversationTreeEdgePathInput {
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

export function createConversationTreeEdgePath({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY
}: ConversationTreeEdgePathInput): string {
  const verticalDistance = Math.max(1, Math.abs(targetY - sourceY))
  const horizontalDistance = targetX - sourceX
  const stableDirection = id.length % 2 === 0 ? 1 : -1
  const direction = Math.abs(horizontalDistance) < 8 ? stableDirection : Math.sign(horizontalDistance)
  const bow = direction * Math.min(42, Math.max(18, verticalDistance * 0.22))
  const firstControlY = sourceY + (targetY - sourceY) * 0.38
  const secondControlY = sourceY + (targetY - sourceY) * 0.62
  return [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + bow},${firstControlY}`,
    `${targetX + bow},${secondControlY}`,
    `${targetX},${targetY}`
  ].join(' ')
}
