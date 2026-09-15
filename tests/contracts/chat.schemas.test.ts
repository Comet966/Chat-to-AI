import { describe, expect, it } from 'vitest'
import {
  CancelChatCommandSchema,
  StartChatCommandSchema
} from 'chat-contracts'

describe('chat.schemas', () => {
  it('should accept a valid start chat command', () => {
    const validCommand = {
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      messages: [
        { role: 'user', content: 'Hello!' }
      ]
    }

    const result = StartChatCommandSchema.safeParse(validCommand)
    expect(result.success).toBe(true)
  })

  it('should reject when the last message is not user', () => {
    const command = {
      requestId: 'req-2',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-2',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' }
      ]
    }

    const result = StartChatCommandSchema.safeParse(command)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('last message in context must be a user message'))).toBe(true)
    }
  })

  it('should reject when the last message content is blank', () => {
    const command = {
      requestId: 'req-3',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-3',
      messages: [
        { role: 'user', content: '   ' }
      ]
    }

    const result = StartChatCommandSchema.safeParse(command)
    expect(result.success).toBe(false)
  })

  it('should reject sensitive or unknown fields (strict schema)', () => {
    const commandWithSensitive = {
      requestId: 'req-4',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-4',
      apiKey: 'sk-secret-leak',
      messages: [
        { role: 'user', content: 'Hello' }
      ]
    }

    const result = StartChatCommandSchema.safeParse(commandWithSensitive)
    expect(result.success).toBe(false)
  })

  it('should reject when message exceeds single message length limit', () => {
    const longContent = 'a'.repeat(32001)
    const command = {
      requestId: 'req-5',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-5',
      messages: [
        { role: 'user', content: longContent }
      ]
    }

    const result = StartChatCommandSchema.safeParse(command)
    expect(result.success).toBe(false)
  })

  it('should validate cancel chat command properly', () => {
    const validCancel = { requestId: 'req-1' }
    expect(CancelChatCommandSchema.safeParse(validCancel).success).toBe(true)

    const emptyCancel = { requestId: '' }
    expect(CancelChatCommandSchema.safeParse(emptyCancel).success).toBe(false)

    const extraFieldsCancel = { requestId: 'req-1', extra: true }
    expect(CancelChatCommandSchema.safeParse(extraFieldsCancel).success).toBe(false)
  })
})
