import React from 'react'
import type { ChatUiMessage } from './chat-ui.types.js'
import { MessageItem } from './MessageItem.js'

export interface MessageListProps {
  messages: ChatUiMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="message-list-empty">
        <div className="empty-title">
          No messages yet
        </div>
        <p className="empty-desc">
          This is a standalone UI preview. Type a message below to test the composer and view simulated demo responses.
        </p>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  )
}
