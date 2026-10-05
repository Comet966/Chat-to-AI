import React from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './app-shell/AppShell.js'
import { ChatPage } from './pages/ChatPage.js'
import { ProviderSettingsPage } from './pages/ProviderSettingsPage.js'

export function AppRoutes() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="settings/providers" element={<ProviderSettingsPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
