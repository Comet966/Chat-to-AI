import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../../apps/test-cli/src/cli-args.js'

describe('cli-args', () => {
  it('should parse valid full options', () => {
    const rawArgs = [
      '--provider', 'anthropic',
      '--base-url', 'https://api.example.com/v1',
      '--api-key', 'sk-test-123',
      '--model-id', 'gpt-4o-mini',
      '--max-output-tokens', '2048',
      '--prompt', 'Hello AI',
      '--timeout-ms', '60000',
      '--format', 'jsonl',
      '--no-color'
    ]

    const result = parseCliArgs(rawArgs)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.args).toEqual({
        provider: 'anthropic',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test-123',
        modelId: 'gpt-4o-mini',
        maxOutputTokens: 2048,
        prompt: 'Hello AI',
        timeoutMs: 60000,
        format: 'jsonl',
        noColor: true
      })
    }
  })

  it('should handle help and version flags', () => {
    expect(parseCliArgs(['-h'])).toEqual({ success: true, args: { help: true } })
    expect(parseCliArgs(['--help'])).toEqual({ success: true, args: { help: true } })
    expect(parseCliArgs(['-v'])).toEqual({ success: true, args: { version: true } })
    expect(parseCliArgs(['--version'])).toEqual({ success: true, args: { version: true } })
  })

  it('should reject unknown options', () => {
    const result = parseCliArgs(['--unknown-flag'])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Unknown option: --unknown-flag')
    }
  })

  it('should reject missing option values', () => {
    expect(parseCliArgs(['--provider']).success).toBe(false)
    expect(parseCliArgs(['--max-output-tokens']).success).toBe(false)
    expect(parseCliArgs(['--base-url']).success).toBe(false)
    expect(parseCliArgs(['--api-key']).success).toBe(false)
    expect(parseCliArgs(['--model-id']).success).toBe(false)
    expect(parseCliArgs(['--prompt']).success).toBe(false)
    expect(parseCliArgs(['--timeout-ms']).success).toBe(false)
    expect(parseCliArgs(['--format']).success).toBe(false)

    // Next arg looks like another flag
    expect(parseCliArgs(['--base-url', '--prompt', 'hello']).success).toBe(false)
  })

  it('should validate timeout-ms is a positive integer', () => {
    expect(parseCliArgs(['--timeout-ms', 'abc']).success).toBe(false)
    expect(parseCliArgs(['--timeout-ms', '-100']).success).toBe(false)
    expect(parseCliArgs(['--timeout-ms', '0']).success).toBe(false)
    expect(parseCliArgs(['--timeout-ms', '12.5']).success).toBe(false)
    expect(parseCliArgs(['--timeout-ms', '5000'])).toEqual({
      success: true,
      args: { timeoutMs: 5000 }
    })
  })

  it('should validate max-output-tokens is a positive integer', () => {
    expect(parseCliArgs(['--max-output-tokens', 'abc']).success).toBe(false)
    expect(parseCliArgs(['--max-output-tokens', '-10']).success).toBe(false)
    expect(parseCliArgs(['--max-output-tokens', '0']).success).toBe(false)
    expect(parseCliArgs(['--max-output-tokens', '1024'])).toEqual({
      success: true,
      args: { maxOutputTokens: 1024 }
    })
  })

  it('should validate format must be text or jsonl', () => {
    expect(parseCliArgs(['--format', 'yaml']).success).toBe(false)
    expect(parseCliArgs(['--format', 'text'])).toEqual({
      success: true,
      args: { format: 'text' }
    })
    expect(parseCliArgs(['--format', 'jsonl'])).toEqual({
      success: true,
      args: { format: 'jsonl' }
    })
  })
})
