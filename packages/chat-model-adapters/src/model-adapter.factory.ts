import type { ChatModelPort } from 'chat-core'
import {
  type ProviderConfig,
  isModelProviderKind
} from './provider-config.js'
import { validateProviderConfig } from './provider-config.schema.js'
import { OpenAICompatibleModelAdapter } from './openai-compatible-model.adapter.js'
import { AnthropicMessagesModelAdapter } from './anthropic-messages-model.adapter.js'
import { GeminiGenerateContentModelAdapter } from './gemini-generate-content-model.adapter.js'

export function createModelAdapter(config: ProviderConfig): ChatModelPort {
  const validation = validateProviderConfig(config)
  if (!validation.success) {
    throw new Error(validation.error)
  }

  const validConfig = validation.config

  if (!isModelProviderKind(validConfig.provider)) {
    throw new Error(`Unsupported model provider: ${(validConfig as { provider?: string }).provider}`)
  }

  switch (validConfig.provider) {
    case 'openai-compatible':
      return new OpenAICompatibleModelAdapter(validConfig)
    case 'anthropic':
      return new AnthropicMessagesModelAdapter(validConfig)
    case 'gemini':
      return new GeminiGenerateContentModelAdapter(validConfig)
  }
}
