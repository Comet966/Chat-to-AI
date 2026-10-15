import {
  AttachmentNameSchema, NamedChatAttachmentsSchema, base64ByteLength,
  MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE,
  type NamedChatAttachment, type ChatAttachment
} from '../../../../shared/chat-attachments.js'

export const CHAT_FILE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.wav,.mp3'
const extensionTypes: Record<string, ChatAttachment['mediaType']> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', wav: 'audio/wav', mp3: 'audio/mpeg'
}
export function chatFileMediaType(file: Pick<File, 'name' | 'type'>): ChatAttachment['mediaType'] {
  let mime = file.type.toLowerCase()
  if (mime === 'audio/x-wav' || mime === 'audio/wave') mime = 'audio/wav'
  if (mime === 'audio/mp3') mime = 'audio/mpeg'
  if (!mime || mime === 'application/octet-stream') mime = extensionTypes[file.name.split('.').at(-1)?.toLowerCase() ?? '']
  if (!Object.values(extensionTypes).includes(mime as ChatAttachment['mediaType'])) {
    throw new Error('仅支持 PNG/JPEG/WebP/GIF 图片、PDF 和 WAV/MP3 音频')
  }
  return mime as ChatAttachment['mediaType']
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取附件失败，请重新选择文件'))
    reader.onabort = () => reject(new Error('附件读取已取消'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const marker = result.indexOf(';base64,')
      if (marker < 0) reject(new Error('无法编码附件'))
      else resolve(result.slice(marker + 8))
    }
    reader.readAsDataURL(file)
  })
}

export async function readChatFiles(files: readonly File[], existing: readonly NamedChatAttachment[]): Promise<NamedChatAttachment[]> {
  if (existing.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error('每条消息最多 10 个附件')
  let bytes = existing.reduce((total, item) => total + (item.attachment.source.type === 'base64'
    ? base64ByteLength(item.attachment.source.data) : 0), 0)
  // Validate the complete selection before allocating any base64 buffers.
  const types = files.map((file) => {
    if (!AttachmentNameSchema.safeParse(file.name).success) throw new Error('附件名称无效，请使用不含路径或控制字符的文件名')
    if (!file.size) throw new Error('不能发送空文件')
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('每个附件最多 20 MiB')
    bytes += file.size
    return chatFileMediaType(file)
  })
  if (bytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('每条消息附件总大小最多 50 MiB')
  const result: NamedChatAttachment[] = [...existing]
  for (const [index, file] of files.entries()) {
    const mediaType = types[index]
    const source = { type: 'base64' as const, data: await readBase64(file) }
    const attachment: ChatAttachment = mediaType === 'application/pdf'
      ? { type: 'document', mediaType, source, filename: file.name }
      : mediaType === 'audio/wav' || mediaType === 'audio/mpeg'
        ? { type: 'audio', mediaType, source } : { type: 'image', mediaType, source }
    result.push({ name: file.name, attachment })
  }
  const parsed = NamedChatAttachmentsSchema.safeParse(result)
  if (!parsed.success) throw new Error('附件格式或大小不符合要求')
  return parsed.data
}
