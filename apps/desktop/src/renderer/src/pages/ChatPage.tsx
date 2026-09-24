import React, { useEffect, useState } from 'react'
import { ChatComposer } from '../features/chat/ChatComposer.js'
import { ChatHeader } from '../features/chat/ChatHeader.js'
import { MessageList } from '../features/chat/MessageList.js'
import { SessionTreePanel } from '../features/session-tree/SessionTreePanel.js'
import { StatusNotice } from '../components/StatusNotice.js'
import { usePorts } from '../ports/ports.context.js'
import type { ChatUiState } from '../ports/chat-ui.port.js'

export function ChatPage() {
  const { chatUi, providerSettings } = usePorts()
  const [chatState, setChatState] = useState<ChatUiState>(chatUi.getState())
  const [providerInfo, setProviderInfo] = useState({ provider: 'openai-compatible', modelId: 'gpt-4o' })

  useEffect(() => {
    let isMounted = true
    void providerSettings.getSettings().then((res) => {
      if (isMounted && res.ok) {
        setProviderInfo({ provider: res.value.provider, modelId: res.value.modelId })
      }
    })
    return () => {
      isMounted = false
    }
  }, [providerSettings])

  useEffect(() => {
    const unsubscribe = chatUi.subscribe(setChatState)
    return () => {
      unsubscribe()
    }
  }, [chatUi])

  const handleSend = async (text: string) => {
    await chatUi.sendMessage(text)
  }

  const handleCancel = async () => {
    await chatUi.cancel()
  }

  return (
    <div className="chat-workspace">
      <SessionTreePanel />
      <section className="conversation-panel" aria-label="对话区域">
        <ChatHeader provider={providerInfo.provider} modelId={providerInfo.modelId} />

        {chatState.status === 'cancelled' && (
          <div className="chat-notice-wrapper">
            <StatusNotice type="warning" message="Last request was cancelled." />
          </div>
        )}

        {chatState.error && (
          <div className="chat-notice-wrapper">
            <StatusNotice type="danger" message={chatState.error} />
          </div>
        )}

        <MessageList messages={chatState.messages} />

        <ChatComposer
          status={chatState.status}
          onSend={handleSend}
          onCancel={handleCancel}
        />
      </section>
    </div>
  )
}
