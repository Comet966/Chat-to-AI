import { ChatKernel } from 'chat-core'
import {
  createModelAdapter,
  redactSecret,
  validateSanitizedUrl,
  validateProviderConfig,
  type ProviderConfig
} from 'chat-model-adapters'
import type {
  DesktopCatalogMode,
  DesktopDevPresetDto,
  DesktopModelCatalogDto,
  DesktopProviderResult,
  DesktopProviderSettingsDto,
  DesktopProviderSettingsInput
} from '../../shared/provider.contract.js'
import type { MutableConversationModelProvider } from '../conversation/desktop-conversation.service.js'

export interface ProviderRuntimeServiceOptions {
  modelProvider: MutableConversationModelProvider
  initialConfig?: ProviderConfig & { catalogMode?: DesktopCatalogMode; catalogBaseUrl?: string }
  hasActiveTurn: () => boolean
  fetchImpl?: typeof fetch
  enableDevPreset?: boolean
  /** Injected by the Electron host so a packaged app can never expose dev-only controls. */
  isPackaged?: boolean
}

export class ProviderRuntimeService {
  private config: (ProviderConfig & { catalogMode?: DesktopCatalogMode; catalogBaseUrl?: string }) | null
  private readonly fetchImpl: typeof fetch
  private readonly enableDevPreset: boolean

  constructor(private readonly options: ProviderRuntimeServiceOptions) {
    this.config = options.initialConfig ?? null
    this.fetchImpl = options.fetchImpl ?? fetch
    this.enableDevPreset =
      !options.isPackaged &&
      (options.enableDevPreset ?? process.env.DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET === '1')
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
            ...(config.anthropicVersion ? { anthropicVersion: config.anthropicVersion } : {}),
            catalogMode: config.catalogMode ?? 'provider-native',
            ...(config.catalogBaseUrl ? { catalogBaseUrl: config.catalogBaseUrl } : {})
          }
        : {
            provider: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            hasApiKey: false,
            modelId: 'gpt-4o',
            maxOutputTokens: 1024,
            catalogMode: 'provider-native'
          }
    }
  }

  public saveSettings(input: DesktopProviderSettingsInput): DesktopProviderResult<void> {
    if (this.options.hasActiveTurn()) {
      return this.failure('TURN_IN_PROGRESS', 'Cannot change provider while a response is streaming')
    }
    const resolved = this.resolveConfig(input)
    if (!resolved.ok) return resolved
    const catalogBaseUrl = this.resolveCatalogBaseUrl(input.catalogBaseUrl)
    if (!catalogBaseUrl.ok) return catalogBaseUrl
    try {
      this.installModel(resolved.value)
      this.config = {
        ...resolved.value,
        catalogMode: input.catalogMode ?? 'provider-native',
        ...(catalogBaseUrl.value ? { catalogBaseUrl: catalogBaseUrl.value } : {})
      }
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
    const catalogMode: DesktopCatalogMode = input.catalogMode ?? 'provider-native'

    if (catalogMode === 'manual-only') {
      return {
        ok: true,
        value: {
          models: [],
          supportsManualEntry: true,
          actualCatalogMode: 'manual-only'
        }
      }
    }

    const resolved = this.resolveConfig(input)
    if (!resolved.ok) return resolved
    const config = resolved.value
    const catalogBaseUrl = this.resolveCatalogBaseUrl(input.catalogBaseUrl)
    if (!catalogBaseUrl.ok) return catalogBaseUrl

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      const modelsUrl = this.buildModelsUrl(config, catalogMode, catalogBaseUrl.value)
      const headers = this.buildHeaders(config, catalogMode)

      const response = await this.fetchImpl(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      })

      if (!response.ok) {
        return this.failure(
          'CONNECTION_FAILED',
          `Provider model request failed with HTTP ${response.status} (${catalogMode})`
        )
      }

      const payload = (await response.json()) as unknown
      const models = this.extractModels(config, catalogMode, payload)

      return {
        ok: true,
        value: {
          models: [...new Set(models)].sort((left, right) => left.localeCompare(right)).slice(0, 500),
          supportsManualEntry: true,
          actualCatalogMode: catalogMode
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

  public getDevPreset(): DesktopProviderResult<DesktopDevPresetDto | null> {
    if (!this.enableDevPreset) {
      return { ok: true, value: null }
    }

    const envKey = process.env.LOCAL_ANTHROPIC_API_KEY || process.env.AI_API_KEY || ''
    return {
      ok: true,
      value: {
        provider: 'anthropic',
        baseUrl: process.env.LOCAL_ANTHROPIC_BASE_URL || 'http://127.0.0.1:8317',
        catalogMode: 'openai-compatible',
        catalogBaseUrl: process.env.LOCAL_ANTHROPIC_CATALOG_URL || 'http://127.0.0.1:8317/v1',
        modelId: process.env.LOCAL_ANTHROPIC_MODEL_ID || 'claude-3-5-sonnet-20241022',
        maxOutputTokens: 2048,
        anthropicVersion: '2023-06-01',
        hasApiKey: Boolean(envKey)
      }
    }
  }

  private resolveConfig(
    input: DesktopProviderSettingsInput
  ): DesktopProviderResult<ProviderConfig> {
    const envKey = this.enableDevPreset
      ? process.env.LOCAL_ANTHROPIC_API_KEY || process.env.AI_API_KEY || ''
      : ''
    const apiKey = input.apiKey.trim() || this.config?.apiKey || envKey
    const validated = validateProviderConfig({ ...input, apiKey })
    if (!validated.success) {
      return this.failure('VALIDATION_FAILED', validated.error, validated.field)
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

  /**
   * A catalog endpoint is Main-owned network input.  Normalize it with the
   * same policy as the generation endpoint before it can receive credentials.
   */
  private resolveCatalogBaseUrl(
    rawCatalogBaseUrl?: string
  ): DesktopProviderResult<string | undefined> {
    if (!rawCatalogBaseUrl?.trim()) return { ok: true, value: undefined }

    const validated = validateSanitizedUrl(rawCatalogBaseUrl)
    if (!validated.success) {
      return this.failure('VALIDATION_FAILED', validated.error, 'catalogBaseUrl')
    }
    return { ok: true, value: validated.url }
  }

  private buildModelsUrl(
    config: ProviderConfig,
    catalogMode: DesktopCatalogMode,
    catalogBaseUrl?: string
  ): string {
    const base = catalogBaseUrl?.trim() || config.baseUrl.trim()

    if (catalogMode === 'openai-compatible') {
      return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
    }

    if (config.provider === 'anthropic') {
      return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
    }

    if (config.provider === 'gemini') {
      return base.endsWith('/v1beta') ? `${base}/models` : `${base}/v1beta/models`
    }

    return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
  }

  private buildHeaders(
    config: ProviderConfig,
    catalogMode: DesktopCatalogMode
  ): Record<string, string> {
    if (catalogMode === 'openai-compatible') {
      return { authorization: `Bearer ${config.apiKey}` }
    }

    if (config.provider === 'anthropic') {
      return {
        'x-api-key': config.apiKey,
        'anthropic-version': config.anthropicVersion ?? '2023-06-01'
      }
    }

    if (config.provider === 'gemini') {
      return { 'x-goog-api-key': config.apiKey }
    }

    return { authorization: `Bearer ${config.apiKey}` }
  }

  private extractModels(
    config: ProviderConfig,
    catalogMode: DesktopCatalogMode,
    payload: unknown
  ): string[] {
    if (!payload || typeof payload !== 'object') return []
    const record = payload as Record<string, unknown>

    if (catalogMode === 'openai-compatible') {
      const entries = record.data
      if (!Array.isArray(entries)) return []
      return entries.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const value = (entry as { id?: unknown }).id
        return typeof value === 'string' && value.length > 0 && value.length <= 256 ? [value] : []
      })
    }

    const entries = config.provider === 'gemini' ? record.models : record.data
    if (!Array.isArray(entries)) return []
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const value =
        config.provider === 'gemini'
          ? (entry as { name?: unknown }).name
          : (entry as { id?: unknown }).id
      if (typeof value !== 'string' || value.length === 0 || value.length > 256) return []
      return [config.provider === 'gemini' ? value.replace(/^models\//, '') : value]
    })
  }

  private toInput(
    config: ProviderConfig & { catalogMode?: DesktopCatalogMode; catalogBaseUrl?: string }
  ): DesktopProviderSettingsInput {
    return {
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelId: config.modelId,
      maxOutputTokens: config.maxOutputTokens,
      ...(config.anthropicVersion ? { anthropicVersion: config.anthropicVersion } : {}),
      ...(config.catalogMode ? { catalogMode: config.catalogMode } : {}),
      ...(config.catalogBaseUrl ? { catalogBaseUrl: config.catalogBaseUrl } : {})
    }
  }

  private failure<T>(
    code: 'NOT_CONFIGURED' | 'TURN_IN_PROGRESS' | 'VALIDATION_FAILED' | 'CONNECTION_FAILED',
    message: string,
    field?: string
  ): DesktopProviderResult<T> {
    return { ok: false, error: { code, message, ...(field ? { field } : {}) } }
  }
}
