// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPage } from '../../apps/desktop/src/renderer/src/pages/ChatPage.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { PortsProvider } from '../../apps/desktop/src/renderer/src/ports/ports.context.js'

import { DemoConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'

describe('ChatPage', () => {
  const renderChatPage = (customAdapter?: DemoChatUiAdapter) => {
    const chatUi = customAdapter ?? new DemoChatUiAdapter()
    const providerSettings = new InMemoryProviderSettingsAdapter({
      provider: 'openai-compatible',
      modelId: 'gpt-4o'
    })
    const conversationTree = new DemoConversationTreeUiAdapter()

    const ports = { chatUi, providerSettings, conversationTree }

    return {
      ports,
      ...render(
        <PortsProvider ports={ports}>
          <ChatPage />
        </PortsProvider>
      )
    }
  }

  it('should render both session tree panel and conversation panel', async () => {
    renderChatPage()

    // Verify session tree panel
    const sessionTreePanel = screen.getByRole('complementary', { name: '会话树' })
    expect(sessionTreePanel).toBeDefined()
    expect(screen.getByRole('heading', { name: '会话脉络' })).toBeDefined()

    // Verify session tree toolbar is rendered
    expect(await screen.findByRole('toolbar', { name: '会话树操作栏' })).toBeDefined()
    expect(screen.getByRole('button', { name: '设为当前节点' })).toBeDefined()
    expect(screen.getByRole('button', { name: '新增子节点或分支' })).toBeDefined()
    expect(screen.getByRole('button', { name: '删除所选节点' })).toBeDefined()

    // Verify conversation panel
    const conversationPanel = screen.getByRole('region', { name: '对话区域' })
    expect(conversationPanel).toBeDefined()
    expect(await screen.findByText('AI Conversation')).toBeDefined()
    expect(within(conversationPanel).getByText('gpt-4o')).toBeDefined()
    expect(within(conversationPanel).getByText('Demo Adapter Active')).toBeDefined()
    expect(within(conversationPanel).getByText('No messages yet')).toBeDefined()
  })

  it('should send message and display user message followed by demo assistant response', async () => {
    const user = userEvent.setup()
    renderChatPage()

    const textarea = screen.getByPlaceholderText(/Type your message/i)
    await user.type(textarea, 'Hello from automated test!')

    const sendBtn = screen.getByRole('button', { name: 'Send' })
    await user.click(sendBtn)

    // User message should appear
    expect(await screen.findByText('Hello from automated test!')).toBeDefined()

    // Assistant demo response should appear
    expect(
      await screen.findByText(/\[UI Preview\] Backend not connected. Your message: "Hello from automated test!" was received by demo adapter\./i)
    ).toBeDefined()

    // Input should be cleared
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('should show Stop button while submitting and allow cancellation', async () => {
    const user = userEvent.setup()
    const slowAdapter = new DemoChatUiAdapter()
    renderChatPage(slowAdapter)

    const textarea = screen.getByPlaceholderText(/Type your message/i)
    await user.type(textarea, 'Cancel me')

    const sendBtn = screen.getByRole('button', { name: 'Send' })
    await user.click(sendBtn)

    // During submission, Stop button should be visible
    const stopBtn = await screen.findByRole('button', { name: 'Stop' })
    expect(stopBtn).toBeDefined()
    await user.click(stopBtn)

    // Status notice should show cancelled
    expect(await screen.findByText('Last request was cancelled.')).toBeDefined()
  })
})
