import React, { useMemo } from 'react'
import { DemoChatUiAdapter } from './adapters/demo-chat-ui.adapter.js'
import { DemoConversationTreeUiAdapter } from './adapters/demo-conversation-tree-ui.adapter.js'
import { InMemoryProviderSettingsAdapter } from './adapters/in-memory-provider-settings.adapter.js'
import type { AppPorts } from './ports/ports.context.js'
import { PortsProvider } from './ports/ports.context.js'
import { AppRoutes } from './routes.js'

export interface AppProps {
  customPorts?: Partial<AppPorts>
}

export function App({ customPorts }: AppProps) {
  const ports = useMemo<AppPorts>(() => {
    return {
      providerSettings: customPorts?.providerSettings ?? new InMemoryProviderSettingsAdapter(),
      chatUi: customPorts?.chatUi ?? new DemoChatUiAdapter(),
      conversationTree: customPorts?.conversationTree ?? new DemoConversationTreeUiAdapter()
    }
  }, [customPorts])

  return (
    <PortsProvider ports={ports}>
      <AppRoutes />
    </PortsProvider>
  )
}
