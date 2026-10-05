import type { DesktopCatalogMode, DesktopDevPresetDto } from '../../../shared/provider.contract.js'

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini'

export interface ProviderSettingsData {
  provider: ProviderKind
  baseUrl: string
  apiKey: string
  hasApiKey?: boolean
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
  catalogMode?: DesktopCatalogMode
  catalogBaseUrl?: string
}

export type ProviderSettingsErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_CONNECTED'
  | 'NOT_CONFIGURED'
  | 'NOT_IMPLEMENTED'
  | 'CONNECTION_FAILED'
  | 'TURN_IN_PROGRESS'
  | 'UNAUTHORIZED_SENDER'
  | 'SERVICE_UNAVAILABLE'
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
  listModels(data: ProviderSettingsData): Promise<ProviderSettingsResult<readonly string[]>>
  getDevPreset?(): Promise<ProviderSettingsResult<DesktopDevPresetDto | null>>
}
