import React, { useEffect, useState, type KeyboardEvent } from 'react'
import type { MessageNode, StartChatCommand } from 'chat-contracts'
import { useChatClient } from '../chat-client.provider.js'
import { useChatStore } from '../store/chat.store.js'

export function DebugChatPanel(): React.JSX.Element {
  const client = useChatClient()
  const [inputText, setInputText] = useState('')

  const {
    conversationId,
    messages,
    streamStatus,
    activeRequestId,
    error,
    appendMessage,
    appendDelta,
    markStreamStarted,
    markStreamCompleted,
    markStreamCancelled,
    markStreamFailed,
    resetConversation
  } = useChatStore()

  const isStreaming = streamStatus === 'streaming'
  const isStarting = streamStatus === 'starting'
  const isBusy = isStreaming || isStarting

  useEffect(() => {
    const unsubscribe = client.subscribe((event) => {
      switch (event.type) {
        case 'chat.stream.started':
          markStreamStarted(event.requestId)
          break
        case 'chat.stream.delta':
          appendDelta(event.assistantMessageId, event.sequence, event.delta)
          break
        case 'chat.stream.completed':
          markStreamCompleted(event.assistantMessageId)
          break
        case 'chat.stream.cancelled':
          markStreamCancelled(event.assistantMessageId)
          break
        case 'chat.stream.failed':
          markStreamFailed(event.assistantMessageId, event.error)
          break
      }
    })

    return () => {
      unsubscribe()
    }
  }, [
    client,
    appendDelta,
    markStreamStarted,
    markStreamCompleted,
    markStreamCancelled,
    markStreamFailed
  ])

  const handleSend = async (): Promise<void> => {
    const trimmed = inputText.trim()
    if (!trimmed || isBusy) {
      return
    }

    const requestId = `req-${Date.now()}`
    const assistantMessageId = `asst-${Date.now()}`
    const userMessageId = `user-${Date.now()}`

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

    const userNode: MessageNode = {
      id: userMessageId,
      conversationId,
      parentId: lastMessage ? lastMessage.id : null,
      role: 'user',
      content: trimmed,
      status: 'complete',
      createdAt: new Date().toISOString()
    }

    const assistantNode: MessageNode = {
      id: assistantMessageId,
      conversationId,
      parentId: userNode.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString()
    }

    appendMessage(userNode)
    appendMessage(assistantNode)
    setInputText('')

    const historyMessages = [...messages, userNode].map((m) => ({
      role: m.role,
      content: m.content
    }))

    const command: StartChatCommand = {
      requestId,
      conversationId,
      assistantMessageId,
      messages: historyMessages
    }

    const result = await client.start(command)
    if (!result.accepted) {
      markStreamFailed(assistantMessageId, result.error)
    }
  }

  const handleStop = async (): Promise<void> => {
    if (!activeRequestId) return
    await client.cancel({ requestId: activeRequestId })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#121212',
        color: '#e0e0e0',
        margin: 0
      }}
    >
      {/* App Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #2d2d2d',
          backgroundColor: '#1a1a1a'
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Debug Chat Panel
          </h2>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            <span>Conv: {conversationId}</span>
            <span style={{ marginLeft: '12px' }}>
              Status:{' '}
              <strong
                style={{
                  color:
                    streamStatus === 'streaming'
                      ? '#4caf50'
                      : streamStatus === 'failed'
                        ? '#f44336'
                        : streamStatus === 'cancelled'
                          ? '#ff9800'
                          : '#aaa'
                }}
              >
                {streamStatus}
              </strong>
            </span>
          </div>
        </div>
        <button
          onClick={resetConversation}
          disabled={isBusy}
          style={{
            padding: '6px 12px',
            backgroundColor: '#2d2d2d',
            color: '#eee',
            border: '1px solid #444',
            borderRadius: '4px',
            cursor: isBusy ? 'not-allowed' : 'pointer'
          }}
        >
          Reset Conversation
        </button>
      </header>

      {/* Error display if any */}
      {error && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b1818',
            color: '#ff8a80',
            borderBottom: '1px solid #5c2424',
            fontSize: '13px'
          }}
        >
          <strong>Error [{error.code}]:</strong> {error.message}
        </div>
      )}

      {/* MessageList */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              color: '#666',
              textAlign: 'center',
              fontSize: '14px'
            }}
          >
            No messages yet. Enter a prompt below to start streaming.
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                backgroundColor: msg.role === 'user' ? '#1e3a5f' : '#222',
                borderRadius: '8px',
                padding: '10px 14px',
                border: '1px solid #333'
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: '#888',
                  marginBottom: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px'
                }}
              >
                <strong>{msg.role}</strong>
                <span>{msg.status}</span>
              </div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '14px',
                  lineHeight: '1.5'
                }}
              >
                {msg.content || (msg.status === 'streaming' ? '...' : '')}
              </div>
            </div>
          ))
        )}
      </main>

      {/* ChatComposer */}
      <footer
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #2d2d2d',
          backgroundColor: '#1a1a1a',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-end'
        }}
      >
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message (Enter to send, Shift+Enter for newline)..."
          rows={3}
          style={{
            flex: 1,
            backgroundColor: '#121212',
            color: '#fff',
            border: '1px solid #333',
            borderRadius: '6px',
            padding: '8px 10px',
            fontSize: '14px',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />
        {isBusy ? (
          <button
            onClick={handleStop}
            style={{
              padding: '10px 20px',
              backgroundColor: '#d32f2f',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => void handleSend()}
            disabled={!inputText.trim()}
            style={{
              padding: '10px 20px',
              backgroundColor: !inputText.trim() ? '#333' : '#1976d2',
              color: !inputText.trim() ? '#777' : '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: !inputText.trim() ? 'not-allowed' : 'pointer'
            }}
          >
            Send
          </button>
        )}
      </footer>
    </div>
  )
}
