import React from 'react'
import { Outlet } from 'react-router-dom'
import { AppNavigation } from './AppNavigation.js'

export function AppShell() {
  return (
    <div className="app-shell">
      <AppNavigation />
      <main className="app-main">
        <div className="preview-banner" role="status">
          当前为 UI Preview，尚未连接内核
        </div>
        <Outlet />
      </main>
    </div>
  )
}
