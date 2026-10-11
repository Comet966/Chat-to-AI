import { StartChatCommandSchema, type ChatMessageInput, type ChatAttachment } from 'chat-contracts'

export function unsupportedCapability(message: string): Error {
  return Object.assign(new Error(message), { code: 'UNSUPPORTED_CAPABILITY' })
}

export function validateModelMessages(messages: ReadonlyArray<ChatMessageInput>): ChatMessageInput[] {
  const result = StartChatCommandSchema.safeParse({
    requestId: 'adapter-validation', conversationId: 'adapter-validation', assistantMessageId: 'adapter-validation', messages
  })
  if (!result.success) throw Object.assign(new Error(result.error.issues[0].message), { code: 'INVALID_REQUEST' })
  return result.data.messages
}

function dataUrl(attachment: ChatAttachment): string {
  if (attachment.source.type === 'url') return attachment.source.url
  return `data:${attachment.mediaType};base64,${attachment.source.data}`
}

export function toOpenAIMessage(message: ChatMessageInput) {
  if (!message.attachments?.length) return { role: message.role, content: message.content }
  const parts: Record<string, unknown>[] = message.content ? [{ type: 'text', text: message.content }] : []
  for (const attachment of message.attachments) {
    switch (attachment.type) {
      case 'image':
        parts.push({ type: 'image_url', image_url: { url: dataUrl(attachment), ...(attachment.detail ? { detail: attachment.detail } : {}) } })
        break
      case 'document':
        if (attachment.source.type === 'url') throw unsupportedCapability('OpenAI Chat Completions requires inline PDF data, not a PDF URL')
        parts.push({ type: 'file', file: { filename: attachment.filename ?? 'document.pdf', file_data: dataUrl(attachment) } })
        break
      case 'audio':
        parts.push({ type: 'input_audio', input_audio: { data: attachment.source.data, format: attachment.mediaType === 'audio/wav' ? 'wav' : 'mp3' } })
    }
  }
  return { role: message.role, content: parts }
}

export function toAnthropicMessage(message: ChatMessageInput) {
  if (!message.attachments?.length) return { role: message.role, content: message.content }
  const parts: Record<string, unknown>[] = message.content ? [{ type: 'text', text: message.content }] : []
  for (const attachment of message.attachments) {
    if (attachment.type === 'audio') throw unsupportedCapability('Anthropic Messages does not support audio input')
    const source = attachment.source.type === 'url'
      ? { type: 'url', url: attachment.source.url }
      : { type: 'base64', media_type: attachment.mediaType, data: attachment.source.data }
    parts.push({ type: attachment.type, source })
  }
  return { role: message.role, content: parts }
}

export function toGeminiParts(message: ChatMessageInput): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = message.content ? [{ text: message.content }] : []
  for (const attachment of message.attachments ?? []) {
    // URL input is deliberately not fetched here: arbitrary remote URLs are
    // not equivalent to provider-uploaded Files API URIs.
    if (attachment.source.type === 'url') throw unsupportedCapability('Use inline base64 media for Gemini; arbitrary remote URLs are not uploaded file URIs')
    parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.source.data } })
  }
  return parts
}
