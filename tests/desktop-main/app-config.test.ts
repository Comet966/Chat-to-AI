import { describe, expect, it } from 'vitest'
import { loadLocalDevProviderConfig } from '../../apps/desktop/src/main/app-config.js'

describe('desktop app configuration', () => {
  it('loads the loopback OpenAI-compatible provider as the development default', () => {
    const config = loadLocalDevProviderConfig({})

    expect(config?.providerConfig).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: '1145141919810',
      modelId: 'gpt-4o',
      catalogMode: 'provider-native'
    })
  })

  it('allows development-only local overrides', () => {
    const config = loadLocalDevProviderConfig({
      LOCAL_OPENAI_BASE_URL: 'http://127.0.0.1:9000/v1',
      LOCAL_OPENAI_API_KEY: 'another-local-key',
      LOCAL_OPENAI_MODEL_ID: 'local-model'
    })
    expect(config?.providerConfig).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9000/v1',
      apiKey: 'another-local-key',
      modelId: 'local-model'
    })
  })

  it('allows the development preset to be disabled explicitly', () => {
    expect(loadLocalDevProviderConfig({
      DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET: '0'
    })).toBeNull()
  })
})
