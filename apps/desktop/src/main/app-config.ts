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

/** Development-only loopback fallback. ElectronHost never loads it when packaged. */
export function loadLocalDevProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): AppConfig | null {
  if (env.DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET === '0') return null

  const apiKey = env.LOCAL_OPENAI_API_KEY?.trim() || '1145141919810'

  const result = resolveProviderConfig(
    {
      provider: 'openai-compatible',
      baseUrl: env.LOCAL_OPENAI_BASE_URL || 'http://127.0.0.1:8317/v1',
      apiKey,
      modelId: env.LOCAL_OPENAI_MODEL_ID || 'gpt-4o',
      maxOutputTokens: env.LOCAL_OPENAI_MAX_OUTPUT_TOKENS || '2048'
    },
    env
  )
  if (!result.success) return null

  return {
    providerConfig: {
      ...result.config,
      catalogMode: 'provider-native'
    },
    aiApiBaseUrl: result.config.baseUrl,
    aiApiKey: result.config.apiKey,
    aiModelId: result.config.modelId
  }
}
