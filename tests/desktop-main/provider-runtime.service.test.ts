import { describe, expect, it, vi } from 'vitest'
import { MutableConversationModelProvider } from '../../apps/desktop/src/main/conversation/desktop-conversation.service.js'
import { ProviderRuntimeService } from '../../apps/desktop/src/main/provider/provider-runtime.service.js'

const baseInput = {
  provider: 'openai-compatible' as const,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'secret-test-key',
  modelId: 'gpt-test',
  maxOutputTokens: 1024
}

describe('ProviderRuntimeService', () => {
  it('keeps API keys write-only while installing a usable model executor', () => {
    const modelProvider = new MutableConversationModelProvider()
    const service = new ProviderRuntimeService({
      modelProvider,
      hasActiveTurn: () => false,
      fetchImpl: vi.fn()
    })
    expect(service.saveSettings(baseInput).ok).toBe(true)
    const settings = service.getSettings()
    expect(settings.ok).toBe(true)
    if (!settings.ok) return
    expect(settings.value.apiKey).toBe('')
    expect(settings.value.hasApiKey).toBe(true)
    expect(JSON.stringify(settings)).not.toContain(baseInput.apiKey)
    expect(modelProvider.getCurrentModel()).toMatchObject({
      providerId: 'openai-compatible', modelId: 'gpt-test'
    })
  })

  it('does not carry the configured key to a different endpoint without explicit input', () => {
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      fetchImpl: vi.fn()
    })
    expect(service.saveSettings(baseInput).ok).toBe(true)

    const changedEndpoint = service.saveSettings({
      ...baseInput,
      baseUrl: 'https://another.example.test/v1',
      apiKey: ''
    })
    expect(changedEndpoint).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', field: 'apiKey' }
    })
  })

  it('loads, deduplicates, and sorts an OpenAI-compatible model catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'model-z' }, { id: 'model-a' }, { id: 'model-a' }]
    }), { status: 200 }))
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      fetchImpl
    })
    const result = await service.listModels(baseInput)
    expect(result).toEqual({
      ok: true,
      value: {
        models: ['model-a', 'model-z'],
        supportsManualEntry: true,
        actualCatalogMode: 'provider-native'
      }
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: { authorization: `Bearer ${baseInput.apiKey}` }
      })
    )
  })

  it('uses Gemini headers and normalizes model names', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'models/gemini-2.5-flash' }]
    }), { status: 200 }))
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      fetchImpl
    })
    const result = await service.listModels({
      ...baseInput,
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com'
    })
    expect(result.ok && result.value.models).toEqual(['gemini-2.5-flash'])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({ headers: { 'x-goog-api-key': baseInput.apiKey } })
    )
  })

  it('normalizes OpenAI-compatible base URL without /v1 when listing models (e.g. http://127.0.0.1:8317)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'local-model' }]
    }), { status: 200 }))
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      fetchImpl
    })
    const result = await service.listModels({
      ...baseInput,
      baseUrl: 'http://127.0.0.1:8317'
    })
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8317/v1/models',
      expect.objectContaining({
        headers: { authorization: `Bearer ${baseInput.apiKey}` }
      })
    )
  })

  it('validates and normalizes the catalog endpoint before Main sends credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => false,
      fetchImpl
    })

    const invalid = await service.listModels({
      ...baseInput,
      catalogMode: 'openai-compatible',
      catalogBaseUrl: 'file:///tmp/models'
    })
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', field: 'catalogBaseUrl' }
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    const normalized = await service.listModels({
      ...baseInput,
      catalogMode: 'openai-compatible',
      catalogBaseUrl: 'https://catalog.example.test/v1?key=must-not-be-accepted'
    })
    expect(normalized).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', field: 'catalogBaseUrl' }
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects configuration replacement during an active turn', () => {
    const service = new ProviderRuntimeService({
      modelProvider: new MutableConversationModelProvider(),
      hasActiveTurn: () => true,
      fetchImpl: vi.fn()
    })
    const result = service.saveSettings(baseInput)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TURN_IN_PROGRESS')
  })
})
