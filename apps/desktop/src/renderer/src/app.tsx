import React, { useEffect, useMemo } from 'react'
import { DemoChatUiAdapter } from './adapters/demo-chat-ui.adapter.js'
import { DemoConversationTreeUiAdapter } from './adapters/demo-conversation-tree-ui.adapter.js'
import { InMemoryProviderSettingsAdapter } from './adapters/in-memory-provider-settings.adapter.js'
import { InMemoryGenerationPreferencesAdapter } from './adapters/in-memory-generation-preferences.adapter.js'
import { ElectronChatUiAdapter } from './adapters/electron-chat-ui.adapter.js'
import { ElectronConversationTreeUiAdapter } from './adapters/electron-conversation-tree-ui.adapter.js'
import { ElectronProviderSettingsAdapter } from './adapters/electron-provider-settings.adapter.js'
import { ElectronGenerationPreferencesAdapter } from './adapters/electron-generation-preferences.adapter.js'
import {
  UnavailableChatUiAdapter,
  UnavailableConversationTreeUiAdapter,
  UnavailableGenerationPreferencesAdapter,
  UnavailableProviderSettingsAdapter
} from './adapters/unavailable-ui.adapters.js'
import type { AppPorts } from './ports/ports.context.js'
import { PortsProvider } from './ports/ports.context.js'
import { AppRoutes } from './routes.js'
import { REALISTIC_CONVERSATION_TREE_FIXTURE } from './adapters/fixtures/realistic-conversation-tree.fixture.js'

export interface AppProps {
  customPorts?: Partial<AppPorts>
}

export function App({ customPorts }: AppProps) {
  const ports = useMemo<AppPorts>(() => {
    const useVisualReviewFixture =
      import.meta.env.DEV && import.meta.env.VITE_DESKTOP_VISUAL_REVIEW === 'conversation-tree'

    if (!customPorts && useVisualReviewFixture) {
      return {
        providerSettings: new InMemoryProviderSettingsAdapter({
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-5'
        }),
        preferences: new InMemoryGenerationPreferencesAdapter(),
        chatUi: new DemoChatUiAdapter(),
        conversationTree: new DemoConversationTreeUiAdapter(
          REALISTIC_CONVERSATION_TREE_FIXTURE
        ),
        runtimeMode: 'preview'
      }
    }
    if (!customPorts && window.desktopApi) {
      return {
        providerSettings: new ElectronProviderSettingsAdapter(window.desktopApi.provider),
        preferences: new ElectronGenerationPreferencesAdapter(window.desktopApi.preferences),
        chatUi: new ElectronChatUiAdapter(window.desktopApi.conversation),
        conversationTree: new ElectronConversationTreeUiAdapter(window.desktopApi.conversation),
        runtimeMode: 'real'
      }
    }
    if (!customPorts) {
      return {
        providerSettings: new UnavailableProviderSettingsAdapter(),
        preferences: new UnavailableGenerationPreferencesAdapter(),
        chatUi: new UnavailableChatUiAdapter(),
        conversationTree: new UnavailableConversationTreeUiAdapter(),
        runtimeMode: 'unavailable'
      }
    }
    return {
      providerSettings: customPorts?.providerSettings ?? new InMemoryProviderSettingsAdapter(),
      preferences: customPorts?.preferences ?? new InMemoryGenerationPreferencesAdapter(),
      chatUi: customPorts?.chatUi ?? new DemoChatUiAdapter(),
      conversationTree: customPorts?.conversationTree ?? new DemoConversationTreeUiAdapter(),
      runtimeMode: customPorts?.runtimeMode ?? 'preview'
    }
  }, [customPorts])

  useEffect(() => {
    ports.chatUi.connect?.()
    ports.conversationTree.connect?.()

    return () => {
      ports.chatUi.dispose?.()
      ports.conversationTree.dispose?.()
    }
  }, [ports])

  return (
    <PortsProvider ports={ports}>
      <AppRoutes />
    </PortsProvider>
  )
}
