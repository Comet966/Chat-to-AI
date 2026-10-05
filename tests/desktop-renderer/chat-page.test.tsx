// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPage } from '../../apps/desktop/src/renderer/src/pages/ChatPage.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { ElectronChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-chat-ui.adapter.js'
import { PortsProvider } from '../../apps/desktop/src/renderer/src/ports/ports.context.js'
import type { ChatUiPort } from '../../apps/desktop/src/renderer/src/ports/chat-ui.port.js'
import type { DesktopApi } from '../../apps/desktop/src/shared/desktop-api.contract.js'
import type { DesktopConversationEvent } from '../../apps/desktop/src/shared/conversation.contract.js'

import { InMemoryGenerationPreferencesAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-generation-preferences.adapter.js'
import { DemoConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'

describe('ChatPage', () => {
  const renderChatPage = (customAdapter?: ChatUiPort) => {
    const chatUi = customAdapter ?? new DemoChatUiAdapter()
    const providerSettings = new InMemoryProviderSettingsAdapter({
      provider: 'openai-compatible',
      modelId: 'gpt-4o'
    })
    const conversationTree = new DemoConversationTreeUiAdapter()
    const preferences = new InMemoryGenerationPreferencesAdapter()

    const ports = { chatUi, providerSettings, conversationTree, preferences }

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

    const renderModeGroup = within(conversationPanel).getByRole('group', {
      name: '回复渲染模式'
    })
    expect(within(renderModeGroup).getByRole('button', { name: 'Markdown' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(renderModeGroup).getByRole('button', { name: 'HTML' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('should switch assistant responses between Markdown and HTML rendering', async () => {
    const user = userEvent.setup()
    const adapter = new DemoChatUiAdapter([
      {
        id: 'assistant-rendering-example',
        role: 'assistant',
        content: '<h3>HTML heading</h3>\n\n**Markdown emphasis**',
        timestamp: new Date().toISOString()
      }
    ])
    renderChatPage(adapter)

    expect(screen.queryByRole('heading', { name: 'HTML heading' })).toBeNull()
    expect(screen.getByText('Markdown emphasis').tagName).toBe('STRONG')

    await user.click(screen.getByRole('button', { name: 'HTML' }))

    expect(screen.getByRole('heading', { name: 'HTML heading' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'HTML' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches rendering modes during an active stream without losing deltas', async () => {
    const listeners = new Set<(event: DesktopConversationEvent) => void>()
    const conversationApi: DesktopApi['conversation'] = {
      getSnapshot: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          treeId: 'stream-tree',
          revision: 0,
          rootTurnId: null,
          currentTurnId: null,
          turns: []
        }
      }),
      setCurrentTurn: vi.fn(),
      startTurn: vi.fn().mockImplementation(async () => {
        const started: DesktopConversationEvent = {
          type: 'conversation.turn.started',
          schemaVersion: 1,
          requestId: 'stream-request',
          treeId: 'stream-tree'
        }
        for (const listener of listeners) listener(started)
        return { ok: true, value: { requestId: 'stream-request' } }
      }),
      cancelTurn: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      onEvent: vi.fn((listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      })
    }
    const adapter = new ElectronChatUiAdapter(conversationApi)
    adapter.connect()
    const user = userEvent.setup()
    const view = renderChatPage(adapter)

    await user.type(screen.getByPlaceholderText(/Type your message/i), 'Stream formatting')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeDefined()

    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'conversation.turn.delta',
          schemaVersion: 1,
          requestId: 'stream-request',
          treeId: 'stream-tree',
          sequence: 0,
          delta: '<h3>Live HTML</h3>\n\n**Live markdown**'
        })
      }
    })
    expect((await screen.findByText('Live markdown')).tagName).toBe('STRONG')
    expect(screen.queryByRole('heading', { name: 'Live HTML' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'HTML' }))
    expect(screen.getByRole('heading', { name: 'Live HTML' })).toBeDefined()

    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'conversation.turn.delta',
          schemaVersion: 1,
          requestId: 'stream-request',
          treeId: 'stream-tree',
          sequence: 1,
          delta: '<p>Second streamed chunk</p>'
        })
      }
    })
    expect(await screen.findByText('Second streamed chunk')).toBeDefined()
    expect(adapter.getState().messages.at(-1)?.content).toBe(
      '<h3>Live HTML</h3>\n\n**Live markdown**<p>Second streamed chunk</p>'
    )

    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(screen.queryByRole('heading', { name: 'Live HTML' })).toBeNull()
    expect(screen.getByText('Live markdown').tagName).toBe('STRONG')
    expect(adapter.getState().status).toBe('streaming')

    view.unmount()
    adapter.dispose()
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

  it('switching render mode does not call conversation or provider APIs and keeps user text as plain text', async () => {
    const user = userEvent.setup()
    const adapter = new DemoChatUiAdapter([
      {
        id: 'u1',
        role: 'user',
        content: '<h3>User input</h3>\n\n**User bold**',
        timestamp: new Date().toISOString()
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '<h3>Assistant output</h3>\n\n**Assistant bold**',
        timestamp: new Date().toISOString()
      }
    ])
    const { ports } = renderChatPage(adapter)

    const sendSpy = vi.spyOn(ports.chatUi, 'sendMessage')
    const cancelSpy = vi.spyOn(ports.chatUi, 'cancel')
    const treeSpy = vi.spyOn(ports.conversationTree, 'setCurrentNode')
    const providerSpy = vi.spyOn(ports.providerSettings, 'saveSettings')

    // Initial Markdown mode
    // User message is plain text
    expect(screen.getByText((content) => content.includes('<h3>User input</h3>'))).toBeDefined()
    // Assistant message renders bold markdown
    expect(screen.getByText('Assistant bold').tagName).toBe('STRONG')

    // Switch to HTML mode
    await user.click(screen.getByRole('button', { name: 'HTML' }))

    // User message remains plain text in HTML mode
    expect(screen.getByText((content) => content.includes('<h3>User input</h3>'))).toBeDefined()
    // Assistant message renders HTML heading
    expect(screen.getByRole('heading', { name: 'Assistant output' })).toBeDefined()

    // No communication APIs were called
    expect(sendSpy).not.toHaveBeenCalled()
    expect(cancelSpy).not.toHaveBeenCalled()
    expect(treeSpy).not.toHaveBeenCalled()
    expect(providerSpy).not.toHaveBeenCalled()
  })

  it('supports keyboard navigation on mode toggle buttons', async () => {
    const user = userEvent.setup()
    renderChatPage()

    const htmlBtn = screen.getByRole('button', { name: 'HTML' })
    htmlBtn.focus()
    expect(document.activeElement).toBe(htmlBtn)

    await user.keyboard('{Enter}')
    expect(htmlBtn.getAttribute('aria-pressed')).toBe('true')

    const mdBtn = screen.getByRole('button', { name: 'Markdown' })
    mdBtn.focus()
    await user.keyboard(' ')
    expect(mdBtn.getAttribute('aria-pressed')).toBe('true')
    expect(htmlBtn.getAttribute('aria-pressed')).toBe('false')
  })
})
