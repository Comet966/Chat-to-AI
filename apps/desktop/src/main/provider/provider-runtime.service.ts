import { ChatKernel } from 'chat-core'
import {
  createModelAdapter,
  redactSecret,
  validateProviderConfig,
  type ProviderConfig
} from 'chat-model-adapters'
import type {
  DesktopModelCatalogDto,
  DesktopProviderResult,
  DesktopProviderSettingsDto,
  DesktopProviderSettingsInput
} from '../../shared/provider.contract.js'
import type { MutableConversationModelProvider } from '../conversation/desktop-conversation.service.js'

export interface ProviderRuntimeServiceOptions {
  modelProvider: MutableConversationModelProvider
  initialConfig?: ProviderConfig
  hasActiveTurn: () => boolean
  fetchImpl?: typeof fetch
}

export class ProviderRuntimeService {
  private config: ProviderConfig | null
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: ProviderRuntimeServiceOptions) {
    this.config = options.initialConfig ?? null
    this.fetchImpl = options.fetchImpl ?? fetch
    if (this.config) this.installModel(this.config)
  }

  public getSettings(): DesktopProviderResult<DesktopProviderSettingsDto> {
    const config = this.config
    return {
      ok: true,
      value: config
        ? {
            provider: config.provider,
            baseUrl: config.baseUrl,
            apiKey: '',
            hasApiKey: true,
            modelId: config.modelId,
            maxOutputTokens: config.maxOutputTokens,
            ...(config.anthropicVersion ? { anthropicVersion: config.anthropicVersion } : {})
          }
        : {
            provider: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            hasApiKey: false,
            modelId: 'gpt-4o',
            maxOutputTokens: 1024
          }
    }
  }

  public saveSettings(input: DesktopProviderSettingsInput): DesktopProviderResult<void> {
    if (this.options.hasActiveTurn()) {
      return this.failure('TURN_IN_PROGRESS', 'Cannot change provider while a response is streaming')
    }
    const resolved = this.resolveConfig(input)
    if (!resolved.ok) return resolved
    try {
      this.installModel(resolved.value)
      this.config = resolved.value
      return { ok: true, value: undefined }
    } catch {
      return this.failure('VALIDATION_FAILED', 'Unable to create the selected provider adapter')
    }
  }

  public clearKey(): DesktopProviderResult<void> {
    if (this.options.hasActiveTurn()) {
      return this.failure('TURN_IN_PROGRESS', 'Cannot clear provider credentials while streaming')
    }
    this.config = null
    this.options.modelProvider.setCurrentModel(null)
    return { ok: true, value: undefined }
  }

  public async testConnection(): Promise<DesktopProviderResult<void>> {
    if (!this.config) return this.failure('NOT_CONFIGURED', 'Provider is not configured')
    const input = this.toInput(this.config)
    const listed = await this.listModels(input)
    return listed.ok ? { ok: true, value: undefined } : listed
  }

  public async listModels(
    input: DesktopProviderSettingsInput
  ): Promise<DesktopProviderResult<DesktopModelCatalogDto>> {
    const resolved = this.resolveConfig(input)
    if (!resolved.ok) return resolved
    const config = resolved.value
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await this.fetchImpl(this.buildModelsUrl(config), {
        method: 'GET',
        headers: this.buildHeaders(config),
        signal: controller.signal
      })
      if (!response.ok) {
        return this.failure(
          'CONNECTION_FAILED',
          `Provider model request failed with HTTP ${response.status}`
        )
      }
      const payload = await response.json() as unknown
      const models = this.extractModels(config, payload)
      return {
        ok: true,
        value: {
          models: [...new Set(models)].sort((left, right) => left.localeCompare(right)).slice(0, 500),
          supportsManualEntry: true
        }
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unknown connection error'
      return this.failure(
        'CONNECTION_FAILED',
        redactSecret(rawMessage, config.apiKey).slice(0, 1000)
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private resolveConfig(
    input: DesktopProviderSettingsInput
  ): DesktopProviderResult<ProviderConfig> {
    const apiKey = input.apiKey.trim() || this.config?.apiKey || ''
    const validated = validateProviderConfig({ ...input, apiKey })
    if (!validated.success) {
      return this.failure('VALIDATION_FAILED', validated.error)
    }
    return { ok: true, value: validated.config }
  }

  private installModel(config: ProviderConfig): void {
    const kernel = new ChatKernel(createModelAdapter(config))
    this.options.modelProvider.setCurrentModel({
      providerId: config.provider,
      modelId: config.modelId,
      executor: kernel
    })
  }

  private buildModelsUrl(config: ProviderConfig): string {
    if (config.provider === 'anthropic') {
      return config.baseUrl.endsWith('/v1')
        ? `${config.baseUrl}/models`
        : `${config.baseUrl}/v1/models`
    }
    if (config.provider === 'gemini') {
      return config.baseUrl.endsWith('/v1beta')
        ? `${config.baseUrl}/models`
        : `${config.baseUrl}/v1beta/models`
    }
    return `${config.baseUrl}/models`
  }

  private buildHeaders(config: ProviderConfig): Record<string, string> {
    if (config.provider === 'anthropic') {
      return {
        'x-api-key': config.apiKey,
        'anthropic-version': config.anthropicVersion ?? '2023-06-01'
      }
    }
    if (config.provider === 'gemini') return { 'x-goog-api-key': config.apiKey }
    return { authorization: `Bearer ${config.apiKey}` }
  }

  private extractModels(config: ProviderConfig, payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') return []
    const record = payload as Record<string, unknown>
    const entries = config.provider === 'gemini' ? record.models : record.data
    if (!Array.isArray(entries)) return []
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const value = config.provider === 'gemini'
        ? (entry as { name?: unknown }).name
        : (entry as { id?: unknown }).id
      if (typeof value !== 'string' || value.length === 0 || value.length > 256) return []
      return [config.provider === 'gemini' ? value.replace(/^models\//, '') : value]
    })
  }

  private toInput(config: ProviderConfig): DesktopProviderSettingsInput {
    return {
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelId: config.modelId,
      maxOutputTokens: config.maxOutputTokens,
      ...(config.anthropicVersion ? { anthropicVersion: config.anthropicVersion } : {})
    }
  }

  private failure<T>(
    code: 'NOT_CONFIGURED' | 'TURN_IN_PROGRESS' | 'VALIDATION_FAILED' | 'CONNECTION_FAILED',
    message: string
  ): DesktopProviderResult<T> {
    return { ok: false, error: { code, message } }
  }
}
