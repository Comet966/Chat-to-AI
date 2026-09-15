import React, { createContext, useContext, type ReactNode } from 'react'
import type { ChatClient } from 'chat-contracts'

const ChatClientContext = createContext<ChatClient | null>(null)

export interface ChatClientProviderProps {
  client: ChatClient
  children: ReactNode
}

export function ChatClientProvider({ client, children }: ChatClientProviderProps): React.JSX.Element {
  return (
    <ChatClientContext.Provider value={client}>
      {children}
    </ChatClientContext.Provider>
  )
}

export function useChatClient(): ChatClient {
  const client = useContext(ChatClientContext)
  if (!client) {
    throw new Error('useChatClient must be used within a ChatClientProvider')
  }
  return client
}
