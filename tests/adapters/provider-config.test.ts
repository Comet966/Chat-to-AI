import { describe, expect, it } from 'vitest'
import {
  createModelAdapter,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  OpenAICompatibleModelAdapter,
  AnthropicMessagesModelAdapter,
  GeminiGenerateContentModelAdapter,
  redactSecret,
  resolveProviderConfig,
  validateProviderConfig,
  type ProviderConfig
} from 'chat-model-adapters'

describe('ProviderConfig and ModelAdapterFactory', () => {
  describe('createModelAdapter', () => {
    it('should instantiate OpenAICompatibleModelAdapter for openai-compatible provider', () => {
      const config: ProviderConfig = {
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
        maxOutputTokens: 1024
      }
      const adapter = createModelAdapter(config)
      expect(adapter).toBeInstanceOf(OpenAICompatibleModelAdapter)
      expect(adapter.modelId).toBe('gpt-4o')
    })

    it('should instantiate AnthropicMessagesModelAdapter for anthropic provider', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'ant-key',
        modelId: 'claude-3-5-sonnet-20241022',
        maxOutputTokens: 2048,
        anthropicVersion: '2023-06-01'
      }
      const adapter = createModelAdapter(config)
      expect(adapter).toBeInstanceOf(AnthropicMessagesModelAdapter)
      expect(adapter.modelId).toBe('claude-3-5-sonnet-20241022')
    })

    it('should instantiate GeminiGenerateContentModelAdapter for gemini provider', () => {
      const config: ProviderConfig = {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'gem-key',
        modelId: 'gemini-1.5-pro',
        maxOutputTokens: 1024
      }
      const adapter = createModelAdapter(config)
      expect(adapter).toBeInstanceOf(GeminiGenerateContentModelAdapter)
      expect(adapter.modelId).toBe('gemini-1.5-pro')
    })

    it('should throw when unknown provider is provided', () => {
      const config = {
        provider: 'unknown-provider',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-key',
        modelId: 'test-model',
        maxOutputTokens: 1024
      } as unknown as ProviderConfig

      expect(() => createModelAdapter(config)).toThrow(/Invalid provider configuration|Unsupported provider/)
    })

    it('should throw if validation fails before creating adapter', () => {
      const invalidConfig = {
        provider: 'openai-compatible',
        baseUrl: '',
        apiKey: '',
        modelId: '',
        maxOutputTokens: -10
      } as unknown as ProviderConfig

      expect(() => createModelAdapter(invalidConfig)).toThrow()
    })
  })

  describe('resolveProviderConfig', () => {
    it('should default to openai-compatible if provider is omitted', () => {
      const res = resolveProviderConfig({
        baseUrl: 'https://my-host.com/v1',
        apiKey: 'my-key',
        modelId: 'my-model'
      }, {})

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.config.provider).toBe('openai-compatible')
        expect(res.config.baseUrl).toBe('https://my-host.com/v1')
        expect(res.config.apiKey).toBe('my-key')
        expect(res.config.modelId).toBe('my-model')
        expect(res.config.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
      }
    })

    it('should resolve default base URL for anthropic and gemini', () => {
      const anthropicRes = resolveProviderConfig({
        provider: 'anthropic',
        apiKey: 'ant-key',
        modelId: 'claude-3-5-haiku-20241022'
      }, {})
      expect(anthropicRes.success).toBe(true)
      if (anthropicRes.success) {
        expect(anthropicRes.config.baseUrl).toBe(DEFAULT_ANTHROPIC_BASE_URL)
        expect(anthropicRes.config.anthropicVersion).toBe(DEFAULT_ANTHROPIC_VERSION)
      }

      const geminiRes = resolveProviderConfig({
        provider: 'gemini',
        apiKey: 'gem-key',
        modelId: 'gemini-1.5-flash'
      }, {})
      expect(geminiRes.success).toBe(true)
      if (geminiRes.success) {
        expect(geminiRes.config.baseUrl).toBe(DEFAULT_GEMINI_BASE_URL)
      }
    })

    it('should fail if openai-compatible has no base URL', () => {
      const res = resolveProviderConfig({
        provider: 'openai-compatible',
        apiKey: 'key',
        modelId: 'model'
      }, {})
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error).toMatch(/Missing required base URL/)
      }
    })

    it('should respect precedence: direct input > env > default', () => {
      const env: NodeJS.ProcessEnv = {
        AI_PROVIDER: 'openai-compatible',
        AI_API_BASE_URL: 'https://env-host.com',
        AI_API_KEY: 'env-key',
        AI_MODEL_ID: 'env-model',
        AI_MAX_OUTPUT_TOKENS: '512'
      }

      const res = resolveProviderConfig({
        provider: 'anthropic',
        baseUrl: 'https://override-host.com',
        apiKey: 'override-key',
        maxOutputTokens: 2048
      }, env)

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.config.provider).toBe('anthropic')
        expect(res.config.baseUrl).toBe('https://override-host.com')
        expect(res.config.apiKey).toBe('override-key')
        expect(res.config.modelId).toBe('env-model') // from env
        expect(res.config.maxOutputTokens).toBe(2048) // direct override
      }
    })

    it('should reject non-http/https URLs', () => {
      const res = resolveProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'ftp://api.example.com',
        apiKey: 'k',
        modelId: 'm'
      }, {})
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error).toMatch(/Invalid URL: protocol must be http: or https:/)
      }
    })

    it('should reject API key passed in URL query parameter', () => {
      const res = resolveProviderConfig({
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com?key=SECRET_KEY',
        apiKey: 'k',
        modelId: 'm'
      }, {})
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error).toMatch(/Security violation: API key must not be passed in the URL query string/)
      }
    })

    it('should reject non-positive maxOutputTokens', () => {
      const res = resolveProviderConfig({
        provider: 'anthropic',
        apiKey: 'k',
        modelId: 'm',
        maxOutputTokens: 0
      }, {})
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error).toMatch(/must be a positive integer/)
      }
    })
  })

  describe('redactSecret', () => {
    it('should mask sensitive keys and headers in error messages', () => {
      const apiKey = 'sk-secret-1234567890'
      const errorMsg = `Error connecting with key ${apiKey} Authorization: Bearer eyJhbGciOi... and x-goog-api-key: myGoogleKey`
      const redacted = redactSecret(errorMsg, apiKey)

      expect(redacted).not.toContain('sk-secret-1234567890')
      expect(redacted).toContain('[REDACTED]')
      expect(redacted).toContain('Bearer [REDACTED]')
      expect(redacted).toContain('x-goog-api-key: [REDACTED]')
    })
  })
})
