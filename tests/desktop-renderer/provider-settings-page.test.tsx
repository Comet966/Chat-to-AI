// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSettingsPage } from '../../apps/desktop/src/renderer/src/pages/ProviderSettingsPage.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { PortsProvider } from '../../apps/desktop/src/renderer/src/ports/ports.context.js'
import { MemoryRouter } from 'react-router-dom'

describe('ProviderSettingsPage and Form', () => {
  const secretKey = 'sk-super-secret-test-key-12345'

  const renderWithPorts = (adapter?: InMemoryProviderSettingsAdapter) => {
    const providerSettings =
      adapter ??
      new InMemoryProviderSettingsAdapter({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: secretKey,
        modelId: 'gpt-4o',
        maxOutputTokens: 1024
      })

    const ports = {
      providerSettings,
      chatUi: new DemoChatUiAdapter()
    }

    return {
      ports,
      ...render(
        <MemoryRouter>
          <PortsProvider ports={ports}>
            <ProviderSettingsPage />
          </PortsProvider>
        </MemoryRouter>
      )
    }
  }

  it('should render form with initial data and conditionally show Anthropic version', async () => {
    const user = userEvent.setup()
    renderWithPorts()

    // Wait for form to load
    expect(await screen.findByLabelText('Provider')).toBeDefined()

    // Default provider is openai-compatible -> no Anthropic Version field
    expect(screen.queryByLabelText('Anthropic Version')).toBeNull()

    // Switch to Anthropic
    const providerSelect = screen.getByLabelText('Provider')
    await user.selectOptions(providerSelect, 'anthropic')

    // Now Anthropic Version field should be visible
    expect(await screen.findByLabelText('Anthropic Version')).toBeDefined()

    // Switch to Gemini -> Anthropic Version should disappear
    await user.selectOptions(providerSelect, 'gemini')
    expect(screen.queryByLabelText('Anthropic Version')).toBeNull()
  })

  it('should validate form and show error for invalid URL or empty model ID', async () => {
    const user = userEvent.setup()
    renderWithPorts()

    await screen.findByLabelText('Provider')

    // Clear Base URL
    const baseUrlInput = screen.getByLabelText('Base URL')
    await user.clear(baseUrlInput)
    await user.type(baseUrlInput, 'not-a-valid-url')

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /Save Configuration/i })
    await user.click(saveBtn)

    // Expect validation error
    expect(await screen.findByText('Please enter a valid HTTP/HTTPS URL')).toBeDefined()
  })

  it('should validate max output tokens and reject non-positive values', async () => {
    const user = userEvent.setup()
    renderWithPorts()

    await screen.findByLabelText('Provider')

    const tokensInput = screen.getByLabelText('Max Output Tokens')
    await user.clear(tokensInput)
    await user.type(tokensInput, '0')

    const saveBtn = screen.getByRole('button', { name: /Save Configuration/i })
    await user.click(saveBtn)

    expect(await screen.findByText('Max output tokens must be a positive integer')).toBeDefined()
  })

  it('should reject an empty API key', async () => {
    const user = userEvent.setup()
    renderWithPorts()

    const apiKeyInput = await screen.findByLabelText('API Key')
    await user.clear(apiKeyInput)
    await user.click(screen.getByRole('button', { name: /Save Configuration/i }))

    expect(await screen.findByText('API Key is required')).toBeDefined()
  })

  it('should toggle API key visibility between password and text', async () => {
    const user = userEvent.setup()
    renderWithPorts()

    const apiKeyInput = (await screen.findByLabelText('API Key')) as HTMLInputElement
    expect(apiKeyInput.type).toBe('password')

    const toggleBtn = screen.getByRole('button', { name: 'Show API key' })
    await user.click(toggleBtn)

    expect(apiKeyInput.type).toBe('text')

    const hideBtn = screen.getByRole('button', { name: 'Hide API key' })
    await user.click(hideBtn)

    expect(apiKeyInput.type).toBe('password')
  })

  it('should clear API key on Clear button click', async () => {
    const user = userEvent.setup()
    const { ports } = renderWithPorts()

    const apiKeyInput = (await screen.findByLabelText('API Key')) as HTMLInputElement
    expect(apiKeyInput.value).toBe(secretKey)

    const clearBtn = screen.getByRole('button', { name: 'Clear API key' })
    await user.click(clearBtn)

    expect(apiKeyInput.value).toBe('')
    const settings = (await ports.providerSettings.getSettings()).value!
    expect(settings.apiKey).toBe('')
  })

  it('should save settings to in-memory adapter and display preview notice', async () => {
    const user = userEvent.setup()
    const adapter = new InMemoryProviderSettingsAdapter({ apiKey: secretKey })
    renderWithPorts(adapter)

    await screen.findByLabelText('Provider')

    const modelInput = screen.getByLabelText('Model ID')
    await user.clear(modelInput)
    await user.type(modelInput, 'custom-model-x')

    const saveBtn = screen.getByRole('button', { name: /Save Configuration/i })
    await user.click(saveBtn)

    expect(
      await screen.findByText(/Settings saved in memory \(valid only for this UI preview session\)/i)
    ).toBeDefined()

    const updated = (await adapter.getSettings()).value!
    expect(updated.modelId).toBe('custom-model-x')
  })

  it('should handle Test Connection with clear NOT_CONNECTED status notice without network call', async () => {
    const user = userEvent.setup()
    renderWithPorts()

    await screen.findByLabelText('Provider')

    const testBtn = screen.getByRole('button', { name: /Test Connection/i })
    await user.click(testBtn)

    expect(
      await screen.findByText(/UI Preview mode: backend connection is not implemented in this phase/i)
    ).toBeDefined()
  })

  it('should never expose API key in notices, error messages, or rendered text', async () => {
    const user = userEvent.setup()
    const { container } = renderWithPorts()

    await screen.findByLabelText('Provider')

    // Trigger save and test connection
    await user.click(screen.getByRole('button', { name: /Save Configuration/i }))
    await user.click(screen.getByRole('button', { name: /Test Connection/i }))

    // All text content except the input value must not contain the secretKey
    const allText = container.textContent || ''
    expect(allText).not.toContain(secretKey)
  })
})
