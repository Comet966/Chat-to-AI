import React, { useCallback, useEffect, useState } from 'react'
import { ChatComposer } from '../features/chat/ChatComposer.js'
import { ChatHeader } from '../features/chat/ChatHeader.js'
import { MessageList } from '../features/chat/MessageList.js'
import { SessionTreePanel } from '../features/session-tree/SessionTreePanel.js'
import { StatusNotice } from '../components/StatusNotice.js'
import { usePorts } from '../ports/ports.context.js'
import type { ChatUiState } from '../ports/chat-ui.port.js'
import type { ConversationInheritanceSelection } from '../ports/conversation-tree-ui.port.js'

export function ChatPage() {
  const { chatUi, providerSettings, conversationTree, runtimeMode } = usePorts()
  const [chatState, setChatState] = useState<ChatUiState>(chatUi.getState())
  const [providerInfo, setProviderInfo] = useState({ provider: 'openai-compatible', modelId: 'gpt-4o' })
  const [inheritanceSelection, setInheritanceSelection] = useState<ConversationInheritanceSelection>({
    mode: 'root-path',
    nodeIds: []
  })

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
    const snapshot = await conversationTree.getSnapshot()
    if (!snapshot.ok) return
    await chatUi.sendMessage({
      content: text,
      expectedRevision: snapshot.value.revision,
      currentNodeId: snapshot.value.currentNodeId || null,
      contextSelection: inheritanceSelection
    })
  }

  const handleInheritanceSelectionChange = useCallback(
    (selection: ConversationInheritanceSelection) => {
      setInheritanceSelection((current) => {
        const unchanged =
          current.mode === selection.mode &&
          current.nodeIds.length === selection.nodeIds.length &&
          current.nodeIds.every((nodeId, index) => nodeId === selection.nodeIds[index])
        return unchanged ? current : selection
      })
    },
    []
  )

  const handleCancel = async () => {
    await chatUi.cancel()
  }

  return (
    <div className="chat-workspace">
      <SessionTreePanel onInheritanceSelectionChange={handleInheritanceSelectionChange} />
      <section className="conversation-panel" aria-label="对话区域">
        <ChatHeader
          provider={providerInfo.provider}
          modelId={providerInfo.modelId}
          runtimeMode={runtimeMode ?? 'preview'}
        />

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
