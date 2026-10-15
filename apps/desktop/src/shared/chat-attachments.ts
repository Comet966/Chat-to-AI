// Renderer-safe contract utilities; no model, Electron, network or filesystem access.
export {
  AttachmentNameSchema, NamedChatAttachmentsSchema, formatAttachmentPrompt, base64ByteLength,
  MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE
} from 'chat-contracts'
export type { NamedChatAttachment, ChatAttachment } from 'chat-contracts'
