export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini'

export interface ProviderSettingsData {
  provider: ProviderKind
  baseUrl: string
  apiKey: string
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
}

export type ProviderSettingsErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_CONNECTED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'

export interface ProviderSettingsError {
  code: ProviderSettingsErrorCode
  message: string
  field?: string
}

export type ProviderSettingsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderSettingsError }

export interface ProviderSettingsPort {
  getSettings(): Promise<ProviderSettingsResult<ProviderSettingsData>>
  saveSettings(data: ProviderSettingsData): Promise<ProviderSettingsResult<void>>
  clearKey(): Promise<void>
  testConnection(): Promise<ProviderSettingsResult<void>>
}
