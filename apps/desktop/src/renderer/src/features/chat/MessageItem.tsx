import React from 'react'
import type { ChatUiMessage } from './chat-ui.types.js'

export interface MessageItemProps {
  message: ChatUiMessage
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const itemClass = isUser ? 'message-item message-item-user' : 'message-item message-item-assistant'
  const bubbleClass = isUser ? 'message-bubble message-bubble-user' : 'message-bubble message-bubble-assistant'

  return (
    <div className={itemClass}>
      <div className={bubbleClass}>
        <div className="message-meta">
          <span className="message-role">{isUser ? 'You' : 'Assistant'}</span>
          {message.isDemo && (
            <span className="message-demo-badge">
              Demo Preview
            </span>
          )}
        </div>
        <div className="message-content">{message.content}</div>
      </div>
    </div>
  )
}
