import React from 'react'

export interface ChatHeaderProps {
  provider: string
  modelId: string
  runtimeMode: 'real' | 'preview' | 'unavailable'
}

export function ChatHeader({ provider, modelId, runtimeMode }: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-header-info">
        <h2 className="chat-header-title">AI Conversation</h2>
        <span className="chat-header-subtitle">
          Active Model: <strong>{modelId}</strong> ({provider})
        </span>
      </div>
      <div className="chat-header-badge">
        {runtimeMode === 'real'
          ? 'Desktop Runtime Connected'
          : runtimeMode === 'preview'
            ? 'Demo Adapter Active'
            : 'Desktop Runtime Unavailable'}
      </div>
    </header>
  )
}
