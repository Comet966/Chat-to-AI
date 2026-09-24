import React, { useState } from 'react'
import { Button } from '../../components/Button.js'
import type { ChatUiStatus } from './chat-ui.types.js'

export interface ChatComposerProps {
  status: ChatUiStatus
  onSend: (text: string) => Promise<void>
  onCancel: () => Promise<void>
}

export function ChatComposer({ status, onSend, onCancel }: ChatComposerProps) {
  const [content, setContent] = useState('')
  const isSubmitting = status === 'submitting-demo'

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!content.trim() || isSubmitting) return

    const toSend = content
    setContent('')
    await onSend(toSend)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="chat-composer">
      <form onSubmit={handleSubmit} className="chat-composer-form">
        <div className="chat-composer-input-wrapper">
          <label htmlFor="chat-input" className="field-label-hidden">
            Message input
          </label>
          <textarea
            id="chat-input"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSubmitting}
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
