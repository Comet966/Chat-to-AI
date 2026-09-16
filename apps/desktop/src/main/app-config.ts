import dotenv from 'dotenv'
import { resolve } from 'node:path'
import {
  resolveProviderConfig,
  type ProviderConfig,
  type RawProviderConfigInput
} from 'chat-model-adapters'

// Load environment variables from .env
dotenv.config({ path: resolve(process.cwd(), '.env') })

export interface AppConfig {
  providerConfig: ProviderConfig
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
