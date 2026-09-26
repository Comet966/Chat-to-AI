import React from 'react'
import { Outlet } from 'react-router-dom'
import { AppNavigation } from './AppNavigation.js'
import { usePorts } from '../ports/ports.context.js'

export function AppShell() {
  const { runtimeMode = 'preview' } = usePorts()
  return (
    <div className="app-shell">
      <AppNavigation />
      <main className="app-main">
        {runtimeMode !== 'real' && (
          <div className="preview-banner" role="status">
            {runtimeMode === 'preview'
              ? '当前为 UI Preview，尚未连接内核'
              : '桌面服务不可用，请通过 Electron 启动应用'}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
