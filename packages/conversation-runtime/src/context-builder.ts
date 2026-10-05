import type { ConversationNode } from 'chat-conversation-tree'
import type { ChatMessageInput } from 'chat-contracts'
import {
  MAX_MESSAGES_COUNT,
  MAX_SINGLE_MESSAGE_LENGTH,
  MAX_TOTAL_MESSAGES_LENGTH
} from 'chat-contracts'
import {
  createRuntimeError
} from './domain/conversation-runtime.errors.js'
import type { ConversationRuntimeResult } from './domain/conversation-runtime.types.js'

export function buildChatContext(
  path: readonly ConversationNode[],
  systemPrompt?: string
): ConversationRuntimeResult<readonly ChatMessageInput[]> {
  if (!Array.isArray(path) || path.length === 0) {
    return {
      ok: false,
      error: createRuntimeError('INVALID_PROMPT', 'Conversation path cannot be empty')
    }
  }

  const hasSystemPrompt = typeof systemPrompt === 'string' && systemPrompt.trim().length > 0
  const totalMessageCount = path.length + (hasSystemPrompt ? 1 : 0)

  if (totalMessageCount > MAX_MESSAGES_COUNT) {
    return {
      ok: false,
      error: createRuntimeError(
        'CONTEXT_LIMIT_EXCEEDED',
        `Conversation path message count ${totalMessageCount} exceeds limit of ${MAX_MESSAGES_COUNT}`
      )
    }
  }

  const lastNode = path[path.length - 1]
  if (lastNode.role !== 'user') {
    return {
      ok: false,
      error: createRuntimeError(
        'INVALID_PROMPT',
        `The last node in conversation path must be a user message, found role "${lastNode.role}"`
      )
    }
  }

  if (!lastNode.content || lastNode.content.trim() === '') {
    return {
      ok: false,
      error: createRuntimeError(
        'INVALID_PROMPT',
        'The last user message content cannot be blank'
      )
    }
  }

  let totalChars = 0
  const messages: ChatMessageInput[] = []

  if (hasSystemPrompt) {
    if (systemPrompt.length > MAX_SINGLE_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: createRuntimeError(
          'CONTEXT_LIMIT_EXCEEDED',
          `System prompt length ${systemPrompt.length} exceeds limit of ${MAX_SINGLE_MESSAGE_LENGTH}`
        )
      }
    }
    totalChars += systemPrompt.length
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  for (const node of path) {
    if (!node.content || typeof node.content !== 'string') {
      return {
        ok: false,
        error: createRuntimeError(
          'INVALID_PROMPT',
          `Message node "${node.id}" content must be a non-empty string`
        )
      }
    }

    if (node.content.length > MAX_SINGLE_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: createRuntimeError(
          'CONTEXT_LIMIT_EXCEEDED',
          `Message node "${node.id}" length ${node.content.length} exceeds limit of ${MAX_SINGLE_MESSAGE_LENGTH}`
        )
      }
    }

    totalChars += node.content.length
    messages.push({
      role: node.role,
      content: node.content
    })
  }

  if (totalChars > MAX_TOTAL_MESSAGES_LENGTH) {
    return {
      ok: false,
      error: createRuntimeError(
        'CONTEXT_LIMIT_EXCEEDED',
        `Total conversation messages length ${totalChars} exceeds limit of ${MAX_TOTAL_MESSAGES_LENGTH}`
      )
    }
  }

  return {
    ok: true,
    value: messages
  }
}
