export type DesktopProviderKind = 'openai-compatible' | 'anthropic' | 'gemini'
export type DesktopCatalogMode = 'provider-native' | 'openai-compatible' | 'manual-only'

export interface DesktopProviderSettingsDto {
  provider: DesktopProviderKind
  baseUrl: string
  /** Write-only. Reads always return an empty string. */
  apiKey: string
  hasApiKey: boolean
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
  catalogMode?: DesktopCatalogMode
  catalogBaseUrl?: string
}

export interface DesktopProviderSettingsInput {
  provider: DesktopProviderKind
  baseUrl: string
  /** Empty preserves the current in-memory key, when one exists. */
  apiKey: string
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
  catalogMode?: DesktopCatalogMode
  catalogBaseUrl?: string
}

export type DesktopProviderErrorCode =
  | 'NOT_CONFIGURED'
  | 'TURN_IN_PROGRESS'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED_SENDER'
  | 'CONNECTION_FAILED'
  | 'INTERNAL_ERROR'

export interface DesktopProviderError {
  code: DesktopProviderErrorCode
  message: string
  field?: string
}

export type DesktopProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopProviderError }

export interface DesktopModelCatalogDto {
  models: readonly string[]
  supportsManualEntry: true
  actualCatalogMode?: DesktopCatalogMode
}

export interface DesktopDevPresetDto {
  provider: DesktopProviderKind
  baseUrl: string
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
  catalogMode: DesktopCatalogMode
  catalogBaseUrl?: string
  hasApiKey: boolean
}
