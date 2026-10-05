import dotenv from 'dotenv'
import { resolve } from 'node:path'
import {
  resolveProviderConfig,
  type ProviderConfig,
  type RawProviderConfigInput
} from 'chat-model-adapters'
import type { DesktopCatalogMode } from '../shared/provider.contract.js'

// Load the package-local and workspace-root environment files. The local file
// intentionally wins so a developer can keep credentials outside the repo.
for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '.env.local'),
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '../../.env.local')
]) {
  dotenv.config({ path: envPath, override: true })
}

export interface DesktopProviderConfig extends ProviderConfig {
  catalogMode?: DesktopCatalogMode
  catalogBaseUrl?: string
}

export interface AppConfig {
  providerConfig: DesktopProviderConfig
  aiApiBaseUrl: string
  aiApiKey: string
  aiModelId: string
}

export function loadAppConfig(overrides?: RawProviderConfigInput): AppConfig {
  const result = resolveProviderConfig(overrides, process.env)
  if (!result.success) {
    throw new Error(`Configuration error: ${result.error}`)
  }

  return {
    providerConfig: result.config,
    aiApiBaseUrl: result.config.baseUrl,
    aiApiKey: result.config.apiKey,
    aiModelId: result.config.modelId
  }
}

/**
 * Resolve the opt-in local test provider used by the desktop GUI.  The key is
 * read only from the process environment; an empty key deliberately means
 * that no initial runtime is installed and the user must configure a provider.
 */
export function loadLocalDevProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): AppConfig | null {
  if (env.DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET !== '1') return null

  const apiKey = env.LOCAL_ANTHROPIC_API_KEY?.trim() || env.AI_API_KEY?.trim()
  if (!apiKey) return null

  const result = resolveProviderConfig(
    {
      provider: 'anthropic',
      baseUrl: env.LOCAL_ANTHROPIC_BASE_URL || 'http://127.0.0.1:8317',
      apiKey,
      modelId: env.LOCAL_ANTHROPIC_MODEL_ID || 'claude-3-5-sonnet-20241022',
      maxOutputTokens: env.LOCAL_ANTHROPIC_MAX_OUTPUT_TOKENS || '2048',
      anthropicVersion: env.LOCAL_ANTHROPIC_VERSION || '2023-06-01'
    },
    env
  )
  if (!result.success) return null

  return {
    providerConfig: {
      ...result.config,
      catalogMode: 'openai-compatible',
      catalogBaseUrl: env.LOCAL_ANTHROPIC_CATALOG_URL || 'http://127.0.0.1:8317/v1'
    },
    aiApiBaseUrl: result.config.baseUrl,
    aiApiKey: result.config.apiKey,
    aiModelId: result.config.modelId
  }
}
