import React, { useEffect, useState } from 'react'
import { Button } from '../../components/Button.js'
import type { ChatUiStatus } from './chat-ui.types.js'

export interface ChatComposerProps {
  status: ChatUiStatus
  onSend: (text: string) => Promise<void>
  onCancel: () => Promise<void>
}

export function ChatComposer({ status, onSend, onCancel }: ChatComposerProps) {
  const [content, setContent] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [streamingNotice, setStreamingNotice] = useState<string | null>(null)
  const isSubmitting = status === 'submitting-demo' || status === 'streaming'

  useEffect(() => {
    if (!isSubmitting) {
      setStreamingNotice(null)
    }
  }, [isSubmitting])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!content.trim() || isSubmitting) return

    const toSend = content
    setContent('')
    setStreamingNotice(null)
    await onSend(toSend)
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
    <div className="chat-composer">
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
            placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
            className="field-textarea chat-composer-textarea"
          />
        </div>
        <div className="chat-composer-actions">
          {isSubmitting ? (
            <Button variant="danger" onClick={onCancel}>
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={!content.trim() || isSubmitting}
            >
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
