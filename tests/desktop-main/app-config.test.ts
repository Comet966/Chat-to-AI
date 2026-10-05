import { describe, expect, it } from 'vitest'
import { loadLocalDevProviderConfig } from '../../apps/desktop/src/main/app-config.js'

describe('desktop app configuration', () => {
  it('loads the local Anthropic provider as the development default when explicitly enabled', () => {
    const config = loadLocalDevProviderConfig({
      DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET: '1',
      LOCAL_ANTHROPIC_API_KEY: 'test-only-key',
      LOCAL_ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
      LOCAL_ANTHROPIC_CATALOG_URL: 'http://127.0.0.1:8317/v1',
      LOCAL_ANTHROPIC_MODEL_ID: 'local-anthropic-model'
    })

    expect(config?.providerConfig).toMatchObject({
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:8317',
      modelId: 'local-anthropic-model',
      catalogMode: 'openai-compatible',
      catalogBaseUrl: 'http://127.0.0.1:8317/v1'
    })
  })

  it('does not create a default runtime without an environment API key', () => {
    expect(loadLocalDevProviderConfig({
      DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET: '1'
    })).toBeNull()
  })

  it('does not create a default runtime unless the opt-in flag is enabled', () => {
    expect(loadLocalDevProviderConfig({
      LOCAL_ANTHROPIC_API_KEY: 'test-only-key'
    })).toBeNull()
  })
})
