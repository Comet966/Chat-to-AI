import React from 'react'

export interface ChatHeaderProps {
  provider: string
  modelId: string
}

export function ChatHeader({ provider, modelId }: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-header-info">
        <h2 className="chat-header-title">AI Conversation</h2>
        <span className="chat-header-subtitle">
          Active Model: <strong>{modelId}</strong> ({provider})
        </span>
      </div>
      <div className="chat-header-badge">
        Demo Adapter Active
      </div>
    </header>
  )
}
