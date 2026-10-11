import { z } from 'zod'
import { ChatAttachmentSchema, MAX_ATTACHMENTS_PER_MESSAGE, MAX_TOTAL_ATTACHMENT_BYTES, base64ByteLength } from './multimodal.schemas.js'

export const MAX_MESSAGES_COUNT = 100
export const MAX_SINGLE_MESSAGE_LENGTH = 32000
export const MAX_TOTAL_MESSAGES_LENGTH = 100000

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant'])

export const ChatMessageInputSchema = z
  .object({
    role: ChatRoleSchema,
    content: z.string().max(MAX_SINGLE_MESSAGE_LENGTH, 'Message content exceeds maximum length'),
    attachments: z.array(ChatAttachmentSchema).min(1).max(MAX_ATTACHMENTS_PER_MESSAGE).optional()
  })
  .strict()
  .superRefine((message, ctx) => {
    if (!message.content.trim() && !message.attachments?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'Message content cannot be empty without attachments' })
    }
    if (message.role !== 'user' && message.attachments?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachments'], message: 'Attachments are supported only on user messages' })
    }
  })

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
    if (!lastMessage) return
    if (lastMessage.role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'The last message in context must be a user message'
      })
    }
    if (lastMessage.content.trim().length === 0 && !lastMessage.attachments?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages', data.messages.length - 1, 'content'],
        message: 'The last user message content must not be blank'
      })
    }

    let totalLength = 0
    let totalAttachmentBytes = 0
    for (let i = 0; i < data.messages.length; i++) {
      totalLength += data.messages[i].content.length
      for (const attachment of data.messages[i].attachments ?? []) {
        if (attachment.source.type === 'base64') totalAttachmentBytes += base64ByteLength(attachment.source.data)
      }
    }
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['messages'], message: 'Total attachment bytes exceed limit' })
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
