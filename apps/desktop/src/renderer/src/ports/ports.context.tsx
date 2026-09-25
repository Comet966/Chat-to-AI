import React, { createContext, useContext } from 'react'
import type { ProviderSettingsPort } from './provider-settings.port.js'
import type { ChatUiPort } from './chat-ui.port.js'
import type { ConversationTreeUiPort } from './conversation-tree-ui.port.js'

export interface AppPorts {
  providerSettings: ProviderSettingsPort
  chatUi: ChatUiPort
  conversationTree: ConversationTreeUiPort
}

const PortsContext = createContext<AppPorts | null>(null)

export function PortsProvider({
  ports,
  children
}: {
  ports: AppPorts
  children: React.ReactNode
}) {
  return <PortsContext.Provider value={ports}>{children}</PortsContext.Provider>
}

export function usePorts(): AppPorts {
  const ports = useContext(PortsContext)
  if (!ports) {
    throw new Error('usePorts must be used within a PortsProvider')
  }
  return ports
}
