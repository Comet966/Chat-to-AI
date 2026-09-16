import type { ChatModelPort } from 'chat-core'

export const MODEL_PROVIDER_KINDS = [
  'openai-compatible',
  'anthropic',
  'gemini'
] as const

export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number]

export interface ProviderConfig {
  provider: ModelProviderKind
  baseUrl: string
  apiKey: string
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
}

export const DEFAULT_PROVIDER: ModelProviderKind = 'openai-compatible'
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

export function isModelProviderKind(value: unknown): value is ModelProviderKind {
  return typeof value === 'string' && (MODEL_PROVIDER_KINDS as readonly string[]).includes(value)
}

export function getDefaultBaseUrl(provider: ModelProviderKind): string | undefined {
  switch (provider) {
    case 'anthropic':
      return DEFAULT_ANTHROPIC_BASE_URL
    case 'gemini':
      return DEFAULT_GEMINI_BASE_URL
    case 'openai-compatible':
      return undefined
  }
}
