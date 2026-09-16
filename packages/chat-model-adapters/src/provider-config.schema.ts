import { z } from 'zod'
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_PROVIDER,
  getDefaultBaseUrl,
  isModelProviderKind,
  MODEL_PROVIDER_KINDS,
  type ModelProviderKind,
  type ProviderConfig
} from './provider-config.js'

export const ProviderConfigSchema = z.object({
  provider: z.enum(MODEL_PROVIDER_KINDS),
  baseUrl: z.string().min(1, 'baseUrl must not be empty'),
  apiKey: z.string().min(1, 'apiKey must not be empty'),
  modelId: z.string().min(1, 'modelId must not be empty'),
  maxOutputTokens: z.number().int().positive('maxOutputTokens must be a positive integer'),
  anthropicVersion: z.string().optional()
})

export interface RawProviderConfigInput {
  provider?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
  maxOutputTokens?: number | string
  anthropicVersion?: string
}

export type ResolveProviderConfigResult =
  | { success: true; config: ProviderConfig }
  | { success: false; error: string }

export function validateSanitizedUrl(rawUrl: string): { success: true; url: string } | { success: false; error: string } {
  let urlObj: URL
  try {
    urlObj = new URL(rawUrl.trim())
  } catch {
    return { success: false, error: `Invalid URL format: "${rawUrl}"` }
  }

  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return { success: false, error: 'Invalid URL: protocol must be http: or https:' }
  }

  if (urlObj.searchParams.has('key')) {
    return { success: false, error: 'Security violation: API key must not be passed in the URL query string' }
  }

  const sanitized = `${urlObj.origin}${urlObj.pathname}`.replace(/\/+$/, '')
  return { success: true, url: sanitized }
}

export function validateProviderConfig(config: unknown): ResolveProviderConfigResult {
  const parseResult = ProviderConfigSchema.safeParse(config)
  if (!parseResult.success) {
    const errorDetails = parseResult.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    return { success: false, error: `Invalid provider configuration: ${errorDetails}` }
  }

  const data = parseResult.data
  const urlValidation = validateSanitizedUrl(data.baseUrl)
  if (!urlValidation.success) {
    return { success: false, error: urlValidation.error }
  }

  return {
    success: true,
    config: {
      ...data,
      baseUrl: urlValidation.url
    }
  }
}

export function resolveProviderConfig(
  input: RawProviderConfigInput = {},
  env: NodeJS.ProcessEnv = process.env
): ResolveProviderConfigResult {
  // 1. Resolve provider (CLI/direct input > env > default)
  const rawProvider = input.provider ?? env.AI_PROVIDER ?? DEFAULT_PROVIDER
  if (!isModelProviderKind(rawProvider)) {
    return {
      success: false,
      error: `Unsupported provider "${rawProvider}". Supported providers: ${MODEL_PROVIDER_KINDS.join(', ')}`
    }
  }
  const provider: ModelProviderKind = rawProvider

  // 2. Resolve base URL (CLI/direct input > env > provider default)
  const defaultBaseUrl = getDefaultBaseUrl(provider)
  const rawBaseUrl = input.baseUrl ?? env.AI_API_BASE_URL ?? defaultBaseUrl

  if (!rawBaseUrl || typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) {
    return {
      success: false,
      error: `Missing required base URL for provider "${provider}". Specify via baseUrl or AI_API_BASE_URL`
    }
  }

  const urlValidation = validateSanitizedUrl(rawBaseUrl)
  if (!urlValidation.success) {
    return { success: false, error: urlValidation.error }
  }
  const baseUrl = urlValidation.url

  // 3. Resolve API key (CLI/direct input > env)
  const rawApiKey = input.apiKey ?? env.AI_API_KEY
  if (!rawApiKey || typeof rawApiKey !== 'string' || !rawApiKey.trim()) {
    return {
      success: false,
      error: `Missing required API key for provider "${provider}". Specify via apiKey or AI_API_KEY`
    }
  }
  const apiKey = rawApiKey.trim()

  // 4. Resolve model ID (CLI/direct input > env)
  const rawModelId = input.modelId ?? env.AI_MODEL_ID
  if (!rawModelId || typeof rawModelId !== 'string' || !rawModelId.trim()) {
    return {
      success: false,
      error: `Missing required model ID for provider "${provider}". Specify via modelId or AI_MODEL_ID`
    }
  }
  const modelId = rawModelId.trim()

  // 5. Resolve maxOutputTokens (CLI/direct input > env > default)
  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS
  const rawMaxTokens = input.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS
  if (rawMaxTokens !== undefined && rawMaxTokens !== null && String(rawMaxTokens).trim() !== '') {
    const parsedTokens = Number(rawMaxTokens)
    if (!Number.isInteger(parsedTokens) || parsedTokens <= 0) {
      return {
        success: false,
        error: `Invalid maxOutputTokens "${rawMaxTokens}": must be a positive integer`
      }
    }
    maxOutputTokens = parsedTokens
  }

  // 6. Resolve anthropicVersion (CLI/direct input > env > default)
  let anthropicVersion: string | undefined
  if (provider === 'anthropic') {
    anthropicVersion = input.anthropicVersion ?? env.AI_ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION
  }

  return {
    success: true,
    config: {
      provider,
      baseUrl,
      apiKey,
      modelId,
      maxOutputTokens,
      ...(anthropicVersion ? { anthropicVersion } : {})
    }
  }
}

export function redactSecret(text: string, secret?: string): string {
  if (!text) return text
  let result = text
  if (secret && secret.trim()) {
    result = result.replaceAll(secret, '[REDACTED]')
  }
  // Mask Bearer tokens
  result = result.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [REDACTED]')
  // Mask x-goog-api-key patterns
  result = result.replace(/x-goog-api-key[:=]\s*[A-Za-z0-9._~+/-]+/gi, 'x-goog-api-key: [REDACTED]')
  return result
}
