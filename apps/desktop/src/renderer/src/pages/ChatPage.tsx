import React, { useCallback, useEffect, useState } from 'react'
import { ChatComposer } from '../features/chat/ChatComposer.js'
import { ChatHeader } from '../features/chat/ChatHeader.js'
import type { MessageRenderMode } from '../features/chat/MessageContent.js'
import { MessageList } from '../features/chat/MessageList.js'
import { SessionTreePanel } from '../features/session-tree/SessionTreePanel.js'
import { StatusNotice } from '../components/StatusNotice.js'
import { usePorts } from '../ports/ports.context.js'
import type { ChatUiState } from '../ports/chat-ui.port.js'
import type { ConversationInheritanceSelection } from '../ports/conversation-tree-ui.port.js'

export function ChatPage() {
  const { chatUi, providerSettings, conversationTree, preferences, runtimeMode } = usePorts()
  const [chatState, setChatState] = useState<ChatUiState>(chatUi.getState())
  const [providerInfo, setProviderInfo] = useState({ provider: 'openai-compatible', modelId: 'gpt-4o' })
  const [renderMode, setRenderMode] = useState<MessageRenderMode>('markdown')
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
    void preferences?.getPreferences().then((res) => {
      if (isMounted && res?.ok) {
        setRenderMode(res.value.activeFormat)
      }
    })
    return () => {
      isMounted = false
    }
  }, [providerSettings, preferences])

  useEffect(() => {
    const unsubscribe = chatUi.subscribe(setChatState)
    return () => {
      unsubscribe()
    }
  }, [chatUi])

  const handleSend = async (text: string) => {
    const snapshotRes = await conversationTree.reload()
    const snapshot = snapshotRes.ok ? snapshotRes : await conversationTree.getSnapshot()
    if (!snapshot.ok) return
    const result = await chatUi.sendMessage({
      content: text,
      expectedRevision: snapshot.value.revision,
      currentNodeId: snapshot.value.currentNodeId || null,
      contextSelection: inheritanceSelection
    })
    if (!result.ok && result.error.code === 'VERSION_CONFLICT') {
      await conversationTree.reload()
    }
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

  const handleRenderModeChange = (mode: MessageRenderMode) => {
    setRenderMode(mode)
    void preferences?.setActiveFormat(mode)
  }

  return (
    <div className="chat-workspace">
      <SessionTreePanel onInheritanceSelectionChange={handleInheritanceSelectionChange} />
      <section className="conversation-panel" aria-label="对话区域">
        <ChatHeader
          provider={providerInfo.provider}
          modelId={providerInfo.modelId}
          runtimeMode={runtimeMode ?? 'preview'}
          renderMode={renderMode}
          onRenderModeChange={handleRenderModeChange}
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

        <MessageList messages={chatState.messages} renderMode={renderMode} />

        <ChatComposer
          status={chatState.status}
          onSend={handleSend}
          onCancel={handleCancel}
        />
      </section>
    </div>
  )
}
