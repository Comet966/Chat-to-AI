import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProviderSettingsForm } from '../features/provider-settings/ProviderSettingsForm.js'
import { usePorts } from '../ports/ports.context.js'
import type { ProviderSettingsData } from '../ports/provider-settings.port.js'
import { DEFAULT_PROVIDER_SETTINGS } from '../adapters/in-memory-provider-settings.adapter.js'

export function ProviderSettingsPage() {
  const { providerSettings } = usePorts()
  const [initialData, setInitialData] = useState<ProviderSettingsData | null>(null)

  useEffect(() => {
    let isMounted = true
    void providerSettings.getSettings().then((res) => {
      if (isMounted) {
        setInitialData(res.ok ? res.value : DEFAULT_PROVIDER_SETTINGS)
      }
    })
    return () => {
      isMounted = false
    }
  }, [providerSettings])

  return (
    <div className="page-container provider-settings-container">
      <div className="settings-back-bar">
        <Link
          to="/chat"
          className="btn btn-secondary settings-back-btn"
        >
          &larr; Back to Chat
        </Link>
      </div>

      {initialData ? (
        <ProviderSettingsForm port={providerSettings} initialData={initialData} />
      ) : (
        <div className="empty-desc">Loading settings...</div>
      )}
    </div>
  )
}
