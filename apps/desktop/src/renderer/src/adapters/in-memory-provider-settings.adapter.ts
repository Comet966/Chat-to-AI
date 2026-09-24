import type {
  ProviderSettingsData,
  ProviderSettingsPort,
  ProviderSettingsResult
} from '../ports/provider-settings.port.js'

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettingsData = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelId: 'gpt-4o',
  maxOutputTokens: 1024
}

export class InMemoryProviderSettingsAdapter implements ProviderSettingsPort {
  private settings: ProviderSettingsData

  constructor(initialSettings: Partial<ProviderSettingsData> = {}) {
    this.settings = {
      ...DEFAULT_PROVIDER_SETTINGS,
      ...initialSettings
    }
  }

  public async getSettings(): Promise<ProviderSettingsResult<ProviderSettingsData>> {
    return {
      ok: true,
      value: { ...this.settings }
    }
  }

  public async saveSettings(data: ProviderSettingsData): Promise<ProviderSettingsResult<void>> {
    if (!data.provider) {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Provider is required', field: 'provider' }
      }
    }

    if (!data.baseUrl || !/^https?:\/\/.+/.test(data.baseUrl)) {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Valid HTTP/HTTPS Base URL is required', field: 'baseUrl' }
      }
    }

    if (!data.apiKey || data.apiKey.trim() === '') {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'API Key is required', field: 'apiKey' }
      }
    }

    if (!data.modelId || data.modelId.trim() === '') {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Model ID is required', field: 'modelId' }
      }
    }

    if (!data.maxOutputTokens || data.maxOutputTokens <= 0 || !Number.isInteger(data.maxOutputTokens)) {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Max output tokens must be a positive integer', field: 'maxOutputTokens' }
      }
    }

    this.settings = { ...data }
    return { ok: true, value: undefined }
  }

  public async clearKey(): Promise<void> {
    this.settings.apiKey = ''
  }

  public async testConnection(): Promise<ProviderSettingsResult<void>> {
    return {
      ok: false,
      error: {
        code: 'NOT_CONNECTED',
        message: 'UI Preview mode: backend connection is not implemented in this phase.'
      }
    }
  }
}
