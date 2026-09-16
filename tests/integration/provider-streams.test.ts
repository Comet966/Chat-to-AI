import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveCliConfig } from '../../apps/test-cli/src/cli-config.js'
import { runCli } from '../../apps/test-cli/src/cli-runner.js'
import { CliOutputHandler } from '../../apps/test-cli/src/cli-output.js'
import { CLI_EXIT_CODES } from '../../apps/test-cli/src/cli-exit-codes.js'

describe('CLI Multi-Provider End-to-End Mock HTTP Integration', () => {
  let server: http.Server
  let serverBaseUrl: string

  const OPENAI_KEY = 'secret-openai-token-xyz'
  const ANTHROPIC_KEY = 'secret-anthropic-token-xyz'
  const GEMINI_KEY = 'secret-gemini-token-xyz'

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })

      req.on('end', () => {
        const url = req.url ?? ''
        const method = req.method ?? ''

        // 1. OpenAI-compatible mock endpoint
        if (url.includes('/chat/completions') && method === 'POST') {
          if (req.headers.authorization !== `Bearer ${OPENAI_KEY}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized key' }))
            return
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })

          res.write('data: {"choices":[{"delta":{"content":"OpenAI "}}]}\n\n')
          res.write('data: {"choices":[{"delta":{"content":"streaming!"}}]}\n\n')
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }

        // 2. Anthropic mock endpoint
        if (url.includes('/v1/messages') && method === 'POST') {
          if (
            req.headers.authorization !== `Bearer ${ANTHROPIC_KEY}` ||
            req.headers['anthropic-version'] !== '2023-06-01'
          ) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized Anthropic key' }))
            return
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })

          res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
          res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Anthropic "}}\n\n')
          res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"streaming!"}}\n\n')
          res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
          res.end()
          return
        }

        // 3. Gemini mock endpoint
        if (url.includes('streamGenerateContent') && method === 'POST') {
          if (req.headers['x-goog-api-key'] !== GEMINI_KEY) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized Google key' }))
            return
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })

          res.write('data: {"candidates":[{"content":{"parts":[{"text":"Gemini "}]}}]}\n\n')
          res.write('data: {"candidates":[{"content":{"parts":[{"text":"streaming!"}]},"finishReason":"STOP"}]}\n\n')
          res.end()
          return
        }

        res.writeHead(404)
        res.end('Not Found')
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo
        serverBaseUrl = `http://127.0.0.1:${addr.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  it('should run openai-compatible stream in text mode and assert complete text without leaking key', async () => {
    const configResult = resolveCliConfig({
      provider: 'openai-compatible',
      baseUrl: serverBaseUrl,
      apiKey: OPENAI_KEY,
      modelId: 'gpt-4o',
      prompt: 'Hello OpenAI',
      format: 'text',
      noColor: true
    }, {})

    expect(configResult.success).toBe(true)
    if (!configResult.success) return

    let stdout = ''
    let stderr = ''
    const output = new CliOutputHandler('text', OPENAI_KEY, true, {
      stdout: (t) => { stdout += t },
      stderr: (t) => { stderr += t }
    })

    const result = await runCli({
      config: configResult.config,
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    expect(stdout).toBe('OpenAI streaming!\n')
    expect(stdout).not.toContain(OPENAI_KEY)
    expect(stderr).not.toContain(OPENAI_KEY)
  })

  it('should run openai-compatible stream in jsonl mode and assert strictly chat.stream events', async () => {
    const configResult = resolveCliConfig({
      provider: 'openai-compatible',
      baseUrl: serverBaseUrl,
      apiKey: OPENAI_KEY,
      modelId: 'gpt-4o',
      prompt: 'Hello OpenAI',
      format: 'jsonl',
      noColor: true
    }, {})

    expect(configResult.success).toBe(true)
    if (!configResult.success) return

    let stdout = ''
    let stderr = ''
    const output = new CliOutputHandler('jsonl', OPENAI_KEY, true, {
      stdout: (t) => { stdout += t },
      stderr: (t) => { stderr += t }
    })

    const result = await runCli({
      config: configResult.config,
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const item of lines) {
      expect(item.type).toMatch(/^chat\.stream\./)
    }
    expect(stdout).not.toContain(OPENAI_KEY)
    expect(stderr).not.toContain(OPENAI_KEY)
  })

  it('should run anthropic stream in text mode and assert complete text without leaking key', async () => {
    const configResult = resolveCliConfig({
      provider: 'anthropic',
      baseUrl: serverBaseUrl,
      apiKey: ANTHROPIC_KEY,
      modelId: 'claude-3-5-sonnet',
      maxOutputTokens: 1024,
      prompt: 'Hello Claude',
      format: 'text',
      noColor: true
    }, {})

    expect(configResult.success).toBe(true)
    if (!configResult.success) return

    let stdout = ''
    let stderr = ''
    const output = new CliOutputHandler('text', ANTHROPIC_KEY, true, {
      stdout: (t) => { stdout += t },
      stderr: (t) => { stderr += t }
    })

    const result = await runCli({
      config: configResult.config,
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    expect(stdout).toBe('Anthropic streaming!\n')
    expect(stdout).not.toContain(ANTHROPIC_KEY)
    expect(stderr).not.toContain(ANTHROPIC_KEY)
  })

  it('should run anthropic stream in jsonl mode and assert strictly chat.stream events', async () => {
    const configResult = resolveCliConfig({
      provider: 'anthropic',
      baseUrl: serverBaseUrl,
      apiKey: ANTHROPIC_KEY,
      modelId: 'claude-3-5-sonnet',
      prompt: 'Hello Claude',
      format: 'jsonl',
      noColor: true
    }, {})

    expect(configResult.success).toBe(true)
    if (!configResult.success) return

    let stdout = ''
    let stderr = ''
    const output = new CliOutputHandler('jsonl', ANTHROPIC_KEY, true, {
      stdout: (t) => { stdout += t },
      stderr: (t) => { stderr += t }
    })

    const result = await runCli({
      config: configResult.config,
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const item of lines) {
      expect(item.type).toMatch(/^chat\.stream\./)
    }
    expect(stdout).not.toContain(ANTHROPIC_KEY)
    expect(stderr).not.toContain(ANTHROPIC_KEY)
  })

  it('should run gemini stream in text mode and assert complete text without leaking key', async () => {
    const configResult = resolveCliConfig({
      provider: 'gemini',
      baseUrl: serverBaseUrl,
      apiKey: GEMINI_KEY,
      modelId: 'gemini-1.5-pro',
      prompt: 'Hello Gemini',
      format: 'text',
      noColor: true
    }, {})

    expect(configResult.success).toBe(true)
    if (!configResult.success) return

    let stdout = ''
    let stderr = ''
    const output = new CliOutputHandler('text', GEMINI_KEY, true, {
      stdout: (t) => { stdout += t },
      stderr: (t) => { stderr += t }
    })

    const result = await runCli({
      config: configResult.config,
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    expect(stdout).toBe('Gemini streaming!\n')
    expect(stdout).not.toContain(GEMINI_KEY)
    expect(stderr).not.toContain(GEMINI_KEY)
  })

  it('should run gemini stream in jsonl mode and assert strictly chat.stream events', async () => {
    const configResult = resolveCliConfig({
      provider: 'gemini',
      baseUrl: serverBaseUrl,
      apiKey: GEMINI_KEY,
      modelId: 'gemini-1.5-pro',
      prompt: 'Hello Gemini',
      format: 'jsonl',
      noColor: true
    }, {})

    expect(configResult.success).toBe(true)
    if (!configResult.success) return

    let stdout = ''
    let stderr = ''
    const output = new CliOutputHandler('jsonl', GEMINI_KEY, true, {
      stdout: (t) => { stdout += t },
      stderr: (t) => { stderr += t }
    })

    const result = await runCli({
      config: configResult.config,
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const item of lines) {
      expect(item.type).toMatch(/^chat\.stream\./)
    }
    expect(stdout).not.toContain(GEMINI_KEY)
    expect(stderr).not.toContain(GEMINI_KEY)
  })
})
