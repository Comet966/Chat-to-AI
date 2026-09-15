import { z } from 'zod'

export const MAX_MESSAGES_COUNT = 100
export const MAX_SINGLE_MESSAGE_LENGTH = 32000
export const MAX_TOTAL_MESSAGES_LENGTH = 100000

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant'])

export const ChatMessageInputSchema = z
  .object({
    role: ChatRoleSchema,
    content: z.string().min(1, 'Message content cannot be empty').max(MAX_SINGLE_MESSAGE_LENGTH, 'Message content exceeds maximum length')
  })
  .strict()

export const StartChatCommandSchema = z
  .object({
    requestId: z.string().min(1, 'requestId cannot be empty'),
    conversationId: z.string().min(1, 'conversationId cannot be empty'),
    assistantMessageId: z.string().min(1, 'assistantMessageId cannot be empty'),
    messages: z
      .array(ChatMessageInputSchema)
      .min(1, 'At least one message is required')
      .max(MAX_MESSAGES_COUNT, `Message count cannot exceed ${MAX_MESSAGES_COUNT}`)
  })
  .strict()
  .superRefine((data, ctx) => {
    const lastMessage = data.messages[data.messages.length - 1]
    if (lastMessage.role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'The last message in context must be a user message'
      })
    }
    if (lastMessage.content.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages', data.messages.length - 1, 'content'],
        message: 'The last user message content must not be blank'
      })
    }

    let totalLength = 0
    for (let i = 0; i < data.messages.length; i++) {
      totalLength += data.messages[i].content.length
    }
    if (totalLength > MAX_TOTAL_MESSAGES_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: `Total messages length exceeds limit of ${MAX_TOTAL_MESSAGES_LENGTH} characters`
      })
    }
  })

export const CancelChatCommandSchema = z
  .object({
    requestId: z.string().min(1, 'requestId cannot be empty')
  })
  .strict()

export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>
export type ValidatedStartChatCommand = z.infer<typeof StartChatCommandSchema>
export type ValidatedCancelChatCommand = z.infer<typeof CancelChatCommandSchema>
