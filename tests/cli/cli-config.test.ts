import { describe, expect, it } from 'vitest'
import { redactSecret, resolveCliConfig } from '../../apps/test-cli/src/cli-config.js'

describe('cli-config', () => {
  it('should give CLI options precedence over environment variables', () => {
    const args = {
      baseUrl: 'https://cli-host.com/v1/',
      apiKey: 'cli-key',
      modelId: 'cli-model',
      prompt: 'CLI prompt',
      timeoutMs: 30000,
      format: 'jsonl' as const,
      noColor: true
    }

    const env = {
      AI_API_BASE_URL: 'https://env-host.com/v1',
      AI_API_KEY: 'env-key',
      AI_MODEL_ID: 'env-model',
      AI_CLI_TIMEOUT_MS: '60000',
      AI_CLI_FORMAT: 'text'
    }

    const result = resolveCliConfig(args, env)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.config.baseUrl).toBe('https://cli-host.com/v1') // Strips trailing slash
      expect(result.config.apiKey).toBe('cli-key')
      expect(result.config.modelId).toBe('cli-model')
      expect(result.config.prompt).toBe('CLI prompt')
      expect(result.config.timeoutMs).toBe(30000)
      expect(result.config.format).toBe('jsonl')
      expect(result.config.noColor).toBe(true)
    }
  })

  it('should fall back to environment variables when CLI options are absent', () => {
    const env = {
      AI_API_BASE_URL: 'https://env-host.com/v1',
      AI_API_KEY: 'env-key',
      AI_MODEL_ID: 'env-model',
      AI_CLI_TIMEOUT_MS: '45000',
      AI_CLI_FORMAT: 'jsonl'
    }

    const result = resolveCliConfig({}, env, 'Piped stdin prompt')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.config.baseUrl).toBe('https://env-host.com/v1')
      expect(result.config.apiKey).toBe('env-key')
      expect(result.config.modelId).toBe('env-model')
      expect(result.config.prompt).toBe('Piped stdin prompt')
      expect(result.config.timeoutMs).toBe(45000)
      expect(result.config.format).toBe('jsonl')
    }
  })

  it('should apply defaults for timeout and format when not provided', () => {
    const args = {
      baseUrl: 'http://localhost:8000',
      apiKey: 'k',
      modelId: 'm',
      prompt: 'hello'
    }

    const result = resolveCliConfig(args, {})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.config.timeoutMs).toBe(120000)
      expect(result.config.format).toBe('text')
      expect(result.config.noColor).toBe(false)
    }
  })

  it('should reject invalid base-url protocols', () => {
    const result = resolveCliConfig({
      baseUrl: 'ftp://invalid-host',
      apiKey: 'k',
      modelId: 'm',
      prompt: 'p'
    }, {})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('protocol must be http or https')
    }
  })

  it('should reject missing prompt when both args.prompt and stdin are absent/empty', () => {
    const result = resolveCliConfig({
      baseUrl: 'https://host',
      apiKey: 'k',
      modelId: 'm'
    }, {}, '   ')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Missing required prompt')
    }
  })

  it('should reject prompts exceeding maximum allowed length', () => {
    const longPrompt = 'a'.repeat(32001)
    const result = resolveCliConfig({
      baseUrl: 'https://host',
      apiKey: 'k',
      modelId: 'm',
      prompt: longPrompt
    }, {})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Prompt exceeds maximum allowed length')
    }
  })

  it('should sanitize and redact secret keys from strings', () => {
    const secret = 'sk-sensitive-secret-token'
    const message = `Failed connecting with key: ${secret} or Bearer sk-sensitive-secret-token`
    const redacted = redactSecret(message, secret)

    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED]')
  })
})
