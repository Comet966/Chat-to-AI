import React from 'react'
import { NavLink } from 'react-router-dom'
import { AppIcon } from '../components/icons/AppIcon.js'
import { ChatIcon } from '../components/icons/ChatIcon.js'
import { SettingsIcon } from '../components/icons/SettingsIcon.js'

export function AppNavigation() {
  return (
    <aside className="app-navigation" aria-label="应用导航">
      <div className="nav-brand" title="Chat to AI" aria-label="Chat to AI">
        <AppIcon size={26} />
      </div>
      <nav className="nav-menu" aria-label="主导航">
        <NavLink
          to="/chat"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          aria-label="对话"
          title="对话"
        >
          <ChatIcon size={22} />
        </NavLink>
        <NavLink
          to="/settings/providers"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          aria-label="供应商配置"
          title="供应商配置"
        >
          <SettingsIcon size={22} />
        </NavLink>
      </nav>
    </aside>
  )
}
