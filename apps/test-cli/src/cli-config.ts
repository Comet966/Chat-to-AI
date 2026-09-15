import { MAX_SINGLE_MESSAGE_LENGTH } from 'chat-contracts'
import type { CliParsedArgs } from './cli-args.js'

export interface TestCliConfig {
  baseUrl: string
  apiKey: string
  modelId: string
  prompt: string
  timeoutMs: number
  format: 'text' | 'jsonl'
  noColor: boolean
}

export type ResolveConfigResult =
  | { success: true; config: TestCliConfig }
  | { success: false; error: string }

export function resolveCliConfig(
  args: CliParsedArgs,
  env: NodeJS.ProcessEnv = process.env,
  stdinContent?: string
): ResolveConfigResult {
  const rawBaseUrl = args.baseUrl ?? env.AI_API_BASE_URL
  if (!rawBaseUrl || typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) {
    return { success: false, error: 'Missing required configuration: base-url (via --base-url or AI_API_BASE_URL)' }
  }

  let sanitizedBaseUrl: string
  try {
    const urlObj = new URL(rawBaseUrl.trim())
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return { success: false, error: 'Invalid base-url: protocol must be http or https' }
    }
    sanitizedBaseUrl = `${urlObj.origin}${urlObj.pathname}`.replace(/\/+$/, '')
  } catch {
    return { success: false, error: `Invalid base-url format: "${rawBaseUrl}"` }
  }

  const rawApiKey = args.apiKey ?? env.AI_API_KEY
  if (!rawApiKey || typeof rawApiKey !== 'string' || !rawApiKey.trim()) {
    return { success: false, error: 'Missing required configuration: api-key (via --api-key or AI_API_KEY)' }
  }
  const apiKey = rawApiKey.trim()

  const rawModelId = args.modelId ?? env.AI_MODEL_ID
  if (!rawModelId || typeof rawModelId !== 'string' || !rawModelId.trim()) {
    return { success: false, error: 'Missing required configuration: model-id (via --model-id or AI_MODEL_ID)' }
  }
  const modelId = rawModelId.trim()

  const rawPrompt = args.prompt ?? stdinContent
  if (rawPrompt === undefined || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return {
      success: false,
      error: 'Missing required prompt: provide --prompt <text> or pipe content via standard input (stdin)'
    }
  }
  const prompt = rawPrompt.trim()

  if (prompt.length > MAX_SINGLE_MESSAGE_LENGTH) {
    return {
      success: false,
      error: `Prompt exceeds maximum allowed length of ${MAX_SINGLE_MESSAGE_LENGTH} characters (was ${prompt.length})`
    }
  }

  let timeoutMs = 120000
  if (args.timeoutMs !== undefined) {
    timeoutMs = args.timeoutMs
  } else if (env.AI_CLI_TIMEOUT_MS) {
    const parsed = Number(env.AI_CLI_TIMEOUT_MS)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { success: false, error: 'Environment variable AI_CLI_TIMEOUT_MS must be a positive integer' }
    }
    timeoutMs = parsed
  }

  let format: 'text' | 'jsonl' = 'text'
  const rawFormat = args.format ?? env.AI_CLI_FORMAT
  if (rawFormat) {
    if (rawFormat === 'text' || rawFormat === 'jsonl') {
      format = rawFormat
    } else {
      return { success: false, error: `Invalid format "${rawFormat}": must be 'text' or 'jsonl'` }
    }
  }

  const noColor = args.noColor ?? Boolean(env.NO_COLOR)

  return {
    success: true,
    config: {
      baseUrl: sanitizedBaseUrl,
      apiKey,
      modelId,
      prompt,
      timeoutMs,
      format,
      noColor
    }
  }
}

export function redactSecret(text: string, secret?: string): string {
  if (!text) return text
  let result = text
  if (secret && secret.trim()) {
    result = result.replaceAll(secret, '[REDACTED]')
  }
  // Also mask standard Bearer tokens if present
  result = result.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [REDACTED]')
  return result
}
