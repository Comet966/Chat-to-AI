import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderRuntimeService } from '../../apps/desktop/src/main/provider/provider-runtime.service.js'
import { MutableConversationModelProvider } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'

describe('ProviderRuntimeService - Catalog Decoupling & Dev Preset', () => {
  let server: http.Server
  let serverUrl: string
  const MOCK_API_KEY = 'secret-proxy-key-456'

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? ''
      const method = req.method ?? ''

      // Local proxy serves OpenAI-compatible /v1/models endpoint
      if (url.includes('/models') && method === 'GET') {
        if (req.headers.authorization !== `Bearer ${MOCK_API_KEY}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Invalid bearer token' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            data: [
              { id: 'claude-3-5-sonnet-20241022' },
              { id: 'claude-3-opus-20240229' },
              { id: 'claude-3-haiku-20240307' }
            ]
          })
        )
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        serverUrl = `http://127.0.0.1:${address.port}/v1`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('supports Anthropic generation protocol with decoupled OpenAI-compatible catalog protocol', async () => {
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      initialConfig: {
        provider: 'anthropic',
        baseUrl: 'http://127.0.0.1:8000',
        apiKey: MOCK_API_KEY,
        modelId: 'claude-3-5-sonnet-20241022',
        maxOutputTokens: 2048,
        catalogMode: 'openai-compatible',
        catalogBaseUrl: serverUrl
      }
    })

    const catalog = await service.listModels({
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: MOCK_API_KEY,
      modelId: 'claude-3-5-sonnet-20241022',
      maxOutputTokens: 2048,
      catalogMode: 'openai-compatible',
      catalogBaseUrl: serverUrl
    })

    expect(catalog.ok).toBe(true)
    if (!catalog.ok) return

    expect(catalog.value.actualCatalogMode).toBe('openai-compatible')
    expect(catalog.value.models).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-3-haiku-20240307',
      'claude-3-opus-20240229'
    ])
  })

  it('returns manual-only mode without network request', async () => {
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false
    })

    const catalog = await service.listModels({
      provider: 'anthropic',
      baseUrl: 'http://invalid-unreachable-host.local',
      apiKey: 'some-key',
      modelId: 'claude-3-5-sonnet',
      maxOutputTokens: 1024,
      catalogMode: 'manual-only'
    })

    expect(catalog.ok).toBe(true)
    if (!catalog.ok) return
    expect(catalog.value.actualCatalogMode).toBe('manual-only')
    expect(catalog.value.models).toHaveLength(0)
    expect(catalog.value.supportsManualEntry).toBe(true)
  })

  it('redacts API key when connection fails', async () => {
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false
    })

    const catalog = await service.listModels({
      provider: 'openai-compatible',
      baseUrl: serverUrl,
      apiKey: 'wrong-secret-key-12345',
      modelId: 'gpt-4o',
      maxOutputTokens: 1024,
      catalogMode: 'openai-compatible'
    })

    expect(catalog.ok).toBe(false)
    if (!catalog.ok) {
      expect(catalog.error.message).not.toContain('wrong-secret-key-12345')
      expect(catalog.error.message).toContain('HTTP 401')
    }
  })

  it('handles dev preset availability based on enableDevPreset option', () => {
    const enabledService = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      enableDevPreset: true
    })
    const enabledPreset = enabledService.getDevPreset()
    expect(enabledPreset.ok).toBe(true)
    if (!enabledPreset.ok) return
    expect(enabledPreset.value).not.toBeNull()
    expect(enabledPreset.value?.provider).toBe('anthropic')
    expect(enabledPreset.value?.catalogMode).toBe('openai-compatible')

    const disabledService = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      enableDevPreset: false
    })
    const disabledPreset = disabledService.getDevPreset()
    expect(disabledPreset.ok).toBe(true)
    if (!disabledPreset.ok) return
    expect(disabledPreset.value).toBeNull()
  })

  it('never exposes the local preset from a packaged application', () => {
    const packagedService = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      enableDevPreset: true,
      isPackaged: true
    })

    expect(packagedService.getDevPreset()).toEqual({ ok: true, value: null })
  })
})
