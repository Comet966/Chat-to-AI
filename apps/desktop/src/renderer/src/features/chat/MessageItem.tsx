import React from 'react'
import type { ChatUiMessage } from './chat-ui.types.js'
import { MessageContent, type MessageRenderMode } from './MessageContent.js'

export interface MessageItemProps {
  message: ChatUiMessage
  renderMode: MessageRenderMode
}

export const MessageItem = React.memo(function MessageItem({ message, renderMode }: MessageItemProps) {
  const isUser = message.role === 'user'
  const itemClass = isUser ? 'message-item message-item-user' : 'message-item message-item-assistant'
  const bubbleClass = isUser ? 'message-bubble message-bubble-user' : 'message-bubble message-bubble-assistant'

  return (
    <div className={itemClass}>
      <div className={bubbleClass}>
        <div className="message-meta">
          <span className="message-role">{isUser ? 'You' : 'Assistant'}</span>
          <div className="message-meta-badges">
            {message.declaredOutputFormat && (
              <span
                className="message-format-badge"
                title={`Declared format: ${message.declaredOutputFormat} (v${message.templateVersion ?? 1})`}
              >
                Format: {message.declaredOutputFormat}
              </span>
            )}
            {message.isDemo && (
              <span className="message-demo-badge">
                Demo Preview
              </span>
            )}
          </div>
        </div>
        <MessageContent
          content={message.content}
          role={message.role}
          renderMode={renderMode}
          declaredOutputFormat={message.declaredOutputFormat}
        />
        {!isUser && message.declaredOutputFormat && message.declaredOutputFormat !== renderMode && (
          <p className="message-format-notice" role="status">
            此回复按请求时声明的 {message.declaredOutputFormat} 格式安全渲染；当前格式选择仅影响下一轮与未声明格式的内容。
          </p>
        )}
      </div>
    </div>
  )
})
