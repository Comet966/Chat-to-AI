import React, { useMemo } from 'react'
import { DemoChatUiAdapter } from './adapters/demo-chat-ui.adapter.js'
import { DemoConversationTreeUiAdapter } from './adapters/demo-conversation-tree-ui.adapter.js'
import { InMemoryProviderSettingsAdapter } from './adapters/in-memory-provider-settings.adapter.js'
import { ElectronChatUiAdapter } from './adapters/electron-chat-ui.adapter.js'
import { ElectronConversationTreeUiAdapter } from './adapters/electron-conversation-tree-ui.adapter.js'
import {
  UnavailableChatUiAdapter,
  UnavailableConversationTreeUiAdapter
} from './adapters/unavailable-ui.adapters.js'
import type { AppPorts } from './ports/ports.context.js'
import { PortsProvider } from './ports/ports.context.js'
import { AppRoutes } from './routes.js'

export interface AppProps {
  customPorts?: Partial<AppPorts>
}

export function App({ customPorts }: AppProps) {
  const ports = useMemo<AppPorts>(() => {
    if (!customPorts && window.desktopApi) {
      return {
        providerSettings: new InMemoryProviderSettingsAdapter(),
        chatUi: new ElectronChatUiAdapter(window.desktopApi.conversation),
        conversationTree: new ElectronConversationTreeUiAdapter(window.desktopApi.conversation),
        runtimeMode: 'real'
      }
    }
    if (!customPorts) {
      return {
        providerSettings: new InMemoryProviderSettingsAdapter(),
        chatUi: new UnavailableChatUiAdapter(),
        conversationTree: new UnavailableConversationTreeUiAdapter(),
        runtimeMode: 'unavailable'
      }
    }
    return {
      providerSettings: customPorts?.providerSettings ?? new InMemoryProviderSettingsAdapter(),
      chatUi: customPorts?.chatUi ?? new DemoChatUiAdapter(),
      conversationTree: customPorts?.conversationTree ?? new DemoConversationTreeUiAdapter(),
      runtimeMode: customPorts?.runtimeMode ?? 'preview'
    }
  }, [customPorts])

  return (
    <PortsProvider ports={ports}>
      <AppRoutes />
    </PortsProvider>
  )
}
