// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../apps/desktop/src/renderer/src/app.js'
import { ElectronProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-provider-settings.adapter.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { DemoConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import { MutableConversationModelProvider } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'
import { ProviderRuntimeService } from '../../apps/desktop/src/main/provider/provider-runtime.service.js'
import type { DesktopProviderSettingsInput } from '../../apps/desktop/src/shared/provider.contract.js'

const firstKey = 'navigation-test-key'
function setup() {
  let active = false
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'catalog-model' }] }), { status: 200 }))
  const service = new ProviderRuntimeService({ modelProvider: new MutableConversationModelProvider(), hasActiveTurn: () => active, fetchImpl, enableDevPreset: false })
  const saveSettings = vi.fn(async (input: DesktopProviderSettingsInput) => service.saveSettings(input))
  const adapter = new ElectronProviderSettingsAdapter({
    getSettings: async () => service.getSettings(), saveSettings,
    clearKey: async () => service.clearKey(), testConnection: () => service.testConnection(),
    listModels: (input) => service.listModels(input), getDevPreset: async () => ({ ok: true, value: null })
  })
  const view = render(<App customPorts={{ providerSettings: adapter, chatUi: new DemoChatUiAdapter(), conversationTree: new DemoConversationTreeUiAdapter() }} />)
  return { ...view, service, fetchImpl, saveSettings, setActive: (value: boolean) => { active = value } }
}
async function saveFirstKey(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: '供应商配置' }))
  await user.type(await screen.findByLabelText('API Key'), firstKey)
  await user.click(screen.getByRole('button', { name: 'Save Configuration' }))
  await screen.findByText(/Settings saved for this application session/)
}
async function leaveAndReturn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: '对话' }))
  await screen.findByText('AI Conversation')
  await user.click(screen.getByRole('link', { name: '供应商配置' }))
  return await screen.findByLabelText('API Key') as HTMLInputElement
}

describe('provider key state across real adapter navigation', () => {
  it('shows a masked configured indication after saving and navigating, and reuses the key for editing and catalogs', async () => {
    const user = userEvent.setup()
    const { service, fetchImpl, saveSettings, container } = setup()
    await saveFirstKey(user)
    const input = screen.getByLabelText('API Key') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toContain('已配置')
    const restored = await leaveAndReturn(user)
    expect(restored.value).toBe('')
    expect(restored.placeholder).toContain('已配置')
    expect(screen.getByText(/切换页面不会清除；留空继续使用/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Show API key' }))
    expect(restored.value).toBe('')
    expect(container.textContent).not.toContain(firstKey)
    await user.clear(screen.getByLabelText('Model ID'))
    await user.type(screen.getByLabelText('Model ID'), 'updated-model')
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }))
    await screen.findByText(/Settings saved for this application session/)
    expect(saveSettings.mock.calls.at(-1)?.[0].apiKey).toBe('')
    expect(service.getRuntimeConfig()).toMatchObject({ apiKey: firstKey, modelId: 'updated-model' })
    await user.click(screen.getByRole('button', { name: 'Load Models' }))
    await screen.findByText('Loaded 1 models.')
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({ headers: { authorization: `Bearer ${firstKey}` } }))
    expect(JSON.stringify(await service.getSettings())).not.toContain(firstKey)
  })

  it('replaces a saved key and clears it only after an explicit successful Clear', async () => {
    const user = userEvent.setup()
    const { service } = setup()
    await saveFirstKey(user)
    const input = await leaveAndReturn(user)
    await user.type(input, 'replacement-key')
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }))
    await screen.findByText(/Settings saved for this application session/)
    expect(service.getRuntimeConfig()?.apiKey).toBe('replacement-key')
    expect((await leaveAndReturn(user)).placeholder).toContain('已配置')
    await user.click(screen.getByRole('button', { name: 'Clear API key' }))
    await screen.findByText('API Key cleared from memory.')
    expect(service.getRuntimeConfig()).toBeNull()
    const cleared = await leaveAndReturn(user)
    expect(cleared.value).toBe('')
    expect(cleared.placeholder).toBe('Enter API Key...')
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }))
    expect(await screen.findByText('API Key is required')).toBeDefined()
  })

  it('does not display an old saved key as configured for another endpoint or protocol', async () => {
    const user = userEvent.setup()
    const { service, saveSettings } = setup()
    await saveFirstKey(user)
    const input = await leaveAndReturn(user)
    await user.clear(screen.getByLabelText('Base URL'))
    await user.type(screen.getByLabelText('Base URL'), 'https://other.example/v1')
    expect(input.placeholder).toBe('Enter API Key...')
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }))
    await screen.findByText('API Key is required')
    expect(saveSettings).toHaveBeenCalledTimes(1)
    await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic')
    expect(input.placeholder).toBe('Enter API Key...')
    expect(service.getRuntimeConfig()?.apiKey).toBe(firstKey)
    expect((await leaveAndReturn(user)).placeholder).toContain('已配置')
  })

  it('does not claim that a key was cleared when Main rejects it during streaming', async () => {
    const user = userEvent.setup()
    const { service, setActive } = setup()
    await saveFirstKey(user)
    const input = await leaveAndReturn(user)
    setActive(true)
    await user.click(screen.getByRole('button', { name: 'Clear API key' }))
    await screen.findByText('Cannot clear provider credentials while streaming')
    expect(input.placeholder).toContain('已配置')
    expect(service.getRuntimeConfig()?.apiKey).toBe(firstKey)
    expect(screen.queryByText('API Key cleared from memory.')).toBeNull()
  })

  it('allows equivalent normalized URLs without dropping a configured key', async () => {
    const user = userEvent.setup()
    const { service } = setup()
    await saveFirstKey(user)
    const input = await leaveAndReturn(user)
    await user.clear(screen.getByLabelText('Base URL'))
    await user.type(screen.getByLabelText('Base URL'), 'https://API.OPENAI.COM:443/v1/')
    expect(input.placeholder).toContain('已配置')
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }))
    await waitFor(() => expect(service.getRuntimeConfig()?.baseUrl).toBe('https://api.openai.com/v1'))
    expect(service.getRuntimeConfig()?.apiKey).toBe(firstKey)
  })
})
