import React, { useMemo } from 'react'
import { DemoChatUiAdapter } from './adapters/demo-chat-ui.adapter.js'
import { InMemoryProviderSettingsAdapter } from './adapters/in-memory-provider-settings.adapter.js'
import type { AppPorts } from './ports/ports.context.js'
import { PortsProvider } from './ports/ports.context.js'
import { AppRoutes } from './routes.js'

export interface AppProps {
  customPorts?: AppPorts
}

export function App({ customPorts }: AppProps) {
  const ports = useMemo<AppPorts>(() => {
    return (
      customPorts ?? {
        providerSettings: new InMemoryProviderSettingsAdapter(),
        chatUi: new DemoChatUiAdapter()
      }
    )
  }, [customPorts])

  return (
    <PortsProvider ports={ports}>
      <AppRoutes />
    </PortsProvider>
  )
}
