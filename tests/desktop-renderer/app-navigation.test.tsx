// @vitest-environment jsdom
import React, { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../apps/desktop/src/renderer/src/app.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { DemoConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'

describe('App Navigation and Routing', () => {
  const createTestPorts = () => ({
    providerSettings: new InMemoryProviderSettingsAdapter({
      provider: 'openai-compatible',
      modelId: 'gpt-4o'
    }),
    chatUi: new DemoChatUiAdapter()
  })

  it('should render icon-only navigation without visible text, but with accessible names', async () => {
    render(<App customPorts={createTestPorts()} />)

    // Verify preview banner is rendered
    expect(screen.getByText('当前为 UI Preview，尚未连接内核')).toBeDefined()

    // Verify navigation links are accessible by accessible name (aria-label)
    const chatLink = screen.getByRole('link', { name: '对话' })
    const settingsLink = screen.getByRole('link', { name: '供应商配置' })

    expect(chatLink).toBeDefined()
    expect(settingsLink).toBeDefined()

    // Verify no visible text in navigation for brand or links
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(nav.textContent).toBe('')

    // Default active link is chat
    expect(chatLink.getAttribute('aria-current')).toBe('page')
    expect(settingsLink.getAttribute('aria-current')).toBeNull()

    // Default page is Chat: header should show AI Conversation
    expect(await screen.findByText('AI Conversation')).toBeDefined()
  })

  it('should navigate between Chat and Provider Settings using icon rail links', async () => {
    const user = userEvent.setup()
    render(<App customPorts={createTestPorts()} />)

    // Click "供应商配置" icon link
    const settingsLink = screen.getByRole('link', { name: '供应商配置' })
    await user.click(settingsLink)

    // Should display Provider Configuration heading
    expect(await screen.findByText('Provider Configuration')).toBeDefined()
    expect(settingsLink.getAttribute('aria-current')).toBe('page')

    // Click "对话" icon link
    const chatLink = screen.getByRole('link', { name: '对话' })
    await user.click(chatLink)

    // Should be back on Chat page
    expect(await screen.findByText('AI Conversation')).toBeDefined()
    expect(chatLink.getAttribute('aria-current')).toBe('page')
  })

  it('should navigate back to Chat from Provider Settings via back button', async () => {
    const user = userEvent.setup()
    render(<App customPorts={createTestPorts()} />)

    // Navigate to settings
    await user.click(screen.getByRole('link', { name: '供应商配置' }))
    expect(await screen.findByText('Provider Configuration')).toBeDefined()

    // Click Back to Chat button
    const backBtn = screen.getByText(/Back to Chat/i)
    await user.click(backBtn)

    expect(await screen.findByText('AI Conversation')).toBeDefined()
  })

  it('should support keyboard navigation (Tab and Enter) to switch routes', async () => {
    const user = userEvent.setup()
    render(<App customPorts={createTestPorts()} />)

    // Initial page: Chat
    expect(await screen.findByText('AI Conversation')).toBeDefined()

    // Tab through to the settings link
    const settingsLink = screen.getByRole('link', { name: '供应商配置' })
    settingsLink.focus()
    expect(document.activeElement).toBe(settingsLink)

    await user.keyboard('{Enter}')

    // Should navigate to settings
    expect(await screen.findByText('Provider Configuration')).toBeDefined()
  })

  it('should safely redirect unknown hash route to default chat page', async () => {
    window.location.hash = '#/unknown/random/route'
    render(<App customPorts={createTestPorts()} />)

    // Should redirect to Chat page
    expect(await screen.findByText('AI Conversation')).toBeDefined()
    const chatLink = screen.getByRole('link', { name: '对话' })
    expect(chatLink.getAttribute('aria-current')).toBe('page')
  })

  it('keeps managed ports connected after the StrictMode effect replay', async () => {
    const chatUi = new DemoChatUiAdapter()
    const conversationTree = new DemoConversationTreeUiAdapter()
    let chatConnected = false
    let treeConnected = false

    const chatConnect = vi.fn(() => {
      chatConnected = true
    })
    const chatDispose = vi.fn(() => {
      chatConnected = false
    })
    const treeConnect = vi.fn(() => {
      treeConnected = true
    })
    const treeDispose = vi.fn(() => {
      treeConnected = false
    })

    Object.assign(chatUi, { connect: chatConnect, dispose: chatDispose })
    Object.assign(conversationTree, { connect: treeConnect, dispose: treeDispose })

    const view = render(
      <StrictMode>
        <App
          customPorts={{
            providerSettings: new InMemoryProviderSettingsAdapter(),
            chatUi,
            conversationTree,
            runtimeMode: 'preview'
          }}
        />
      </StrictMode>
    )

    await waitFor(() => {
      expect(chatConnected).toBe(true)
      expect(treeConnected).toBe(true)
    })
    expect(chatConnect).toHaveBeenCalled()
    expect(treeConnect).toHaveBeenCalled()

    view.unmount()
    expect(chatConnected).toBe(false)
    expect(treeConnected).toBe(false)
    expect(chatDispose).toHaveBeenCalled()
    expect(treeDispose).toHaveBeenCalled()
  })
})
