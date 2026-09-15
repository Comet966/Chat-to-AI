import React, { useMemo } from 'react'
import type { ChatClient } from 'chat-contracts'
import { ChatClientProvider } from './chat-client.provider.js'
import { ElectronChatClient } from './clients/electron-chat.client.js'
import { DebugChatPanel } from './components/DebugChatPanel.js'

export interface DebugAppProps {
  client?: ChatClient
}

export function DebugApp({ client }: DebugAppProps): React.JSX.Element {
  const chatClient = useMemo(() => client ?? new ElectronChatClient(), [client])

  return (
    <ChatClientProvider client={chatClient}>
      <DebugChatPanel />
    </ChatClientProvider>
  )
}
