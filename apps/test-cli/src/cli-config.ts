import { MAX_SINGLE_MESSAGE_LENGTH } from 'chat-contracts'
import {
  resolveProviderConfig,
  redactSecret,
  type ProviderConfig,
  type ModelProviderKind
} from 'chat-model-adapters'
import type { CliParsedArgs } from './cli-args.js'

export { redactSecret }

export interface TestCliConfig {
  provider: ModelProviderKind
  baseUrl: string
  apiKey: string
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
  providerConfig: ProviderConfig
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
  const providerRes = resolveProviderConfig(
    {
      provider: args.provider,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      modelId: args.modelId,
      maxOutputTokens: args.maxOutputTokens
    },
    env
  )

  if (!providerRes.success) {
    return { success: false, error: providerRes.error }
  }

  const providerConfig = providerRes.config

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
      provider: providerConfig.provider,
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      modelId: providerConfig.modelId,
      maxOutputTokens: providerConfig.maxOutputTokens,
      anthropicVersion: providerConfig.anthropicVersion,
      providerConfig,
      prompt,
      timeoutMs,
      format,
      noColor
    }
  }
}
