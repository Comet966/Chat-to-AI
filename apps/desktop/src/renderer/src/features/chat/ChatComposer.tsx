import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button.js'
import type { ChatUiStatus } from './chat-ui.types.js'
import type { NamedChatAttachment } from '../../../../shared/chat-attachments.js'
import { CHAT_FILE_ACCEPT, readChatFiles } from './read-chat-files.js'

export interface ChatComposerProps {
  status: ChatUiStatus
  onSend: (text: string, attachments?: NamedChatAttachment[]) => Promise<void | boolean>
  onCancel: () => Promise<void>
}

export function ChatComposer({ status, onSend, onCancel }: ChatComposerProps) {
  const [content, setContent] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [streamingNotice, setStreamingNotice] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<NamedChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [reading, setReading] = useState(false)
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const readingRef = useRef(false)
  const sendingRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const isSubmitting = status === 'submitting-demo' || status === 'streaming'

  useEffect(() => {
    if (!isSubmitting) {
      setStreamingNotice(null)
    }
  }, [isSubmitting])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if ((!content.trim() && !attachments.length) || isSubmitting || readingRef.current || sendingRef.current) return

    const toSend = content
    const toAttachments = attachments
    sendingRef.current = true
    setSending(true)
    setContent('')
    setAttachments([])
    setAttachmentError('')
    setStreamingNotice(null)
    try {
      const accepted = toAttachments.length ? await onSend(toSend, toAttachments) : await onSend(toSend)
      if (accepted === false && mounted.current) {
        setContent((draft) => draft ? `${toSend}\n${draft}` : toSend)
        setAttachments(toAttachments)
      }
    } catch {
      if (mounted.current) {
        setContent((draft) => draft ? `${toSend}\n${draft}` : toSend)
        setAttachments(toAttachments)
        setAttachmentError('发送失败，已保留文本和附件，请重试')
      }
    } finally { sendingRef.current = false; if (mounted.current) setSending(false) }
  }

  async function addFiles(files: File[]) {
    if (!files.length || readingRef.current || sendingRef.current) return
    readingRef.current = true
    setReading(true)
    setAttachmentError('')
    try {
      const next = await readChatFiles(files, attachments)
      if (mounted.current) setAttachments(next)
    } catch (error) { if (mounted.current) setAttachmentError(error instanceof Error ? error.message : '读取附件失败') }
    finally { readingRef.current = false; if (mounted.current) setReading(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isImeComposing =
      isComposing ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isImeComposing) {
        // IME candidate selection, do not submit
        return
      }

      e.preventDefault()

      if (isSubmitting) {
        setStreamingNotice('AI 正在回复中，草稿已保留，可在回复完成后发送或点击 Stop 中止。')
        return
      }

      void handleSubmit()
    }
  }

  return (
    <div className="chat-composer"
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) } }}>
      {attachmentError && <div role="alert" className="composer-draft-notice">{attachmentError}</div>}
      {reading && <div role="status" className="composer-draft-notice">正在读取附件…</div>}
      {!!attachments.length && <div className="composer-attachments" aria-label="本轮附件">
        {attachments.map((item, index) => <div className="composer-attachment" key={`${index}-${item.name}`}>
          {item.attachment.type === 'image' && item.attachment.source.type === 'base64' &&
            <img src={`data:${item.attachment.mediaType};base64,${item.attachment.source.data}`} alt={`附件预览：${item.name}`} />}
          <span>{item.name}</span>
          <Button variant="secondary" disabled={reading || sending} onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}
            aria-label={`移除附件 ${item.name}`}>移除</Button>
        </div>)}
        <p className="field-hint">发送成功后附件保存在本地，并随选中的历史节点参与后续上下文。</p>
      </div>}
      {streamingNotice && (
        <div className="composer-draft-notice" role="status">
          {streamingNotice}
        </div>
      )}
      <form onSubmit={handleSubmit} className="chat-composer-form">
        <div className="chat-composer-input-wrapper">
          <label htmlFor="chat-input" className="field-label-hidden">
            Message input
          </label>
          <textarea
            id="chat-input"
            rows={3}
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              if (streamingNotice) setStreamingNotice(null)
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length) { event.preventDefault(); void addFiles(files) }
            }}
            placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
            className="field-textarea chat-composer-textarea"
          />
        </div>
        <div className="chat-composer-actions">
          <input ref={fileInput} type="file" multiple accept={CHAT_FILE_ACCEPT} hidden aria-label="选择聊天附件"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void addFiles(files)
            }} />
          <Button variant="secondary" disabled={reading || sending} onClick={() => fileInput.current?.click()}>添加附件</Button>
          {isSubmitting ? (
            <Button variant="danger" onClick={onCancel}>
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={(!content.trim() && !attachments.length) || isSubmitting || reading || sending}
            >
              Send
            </Button>
          )}
        </div>
      </form>
      <p className="field-hint composer-file-hint">支持图片、PDF、WAV/MP3；单文件 ≤20 MiB，总计 ≤50 MiB，最多 10 个。模型需支持对应输入类型。</p>
    </div>
  )
}
