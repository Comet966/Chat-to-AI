import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ChatKernel, type ChatModelPort } from 'chat-core'
import type { ChatRole } from 'chat-contracts'
import { CLI_EXIT_CODES } from '../../apps/test-cli/src/cli-exit-codes.js'
import { CliOutputHandler } from '../../apps/test-cli/src/cli-output.js'
import { runCli } from '../../apps/test-cli/src/cli-runner.js'

class FakeCliModel implements ChatModelPort {
  public readonly modelId = 'fake-cli-model'
  public delayMs = 10
  public shouldFail = false
  public failureStatus = 500
  public chunks: Array<{ type: 'text-delta'; text: string } | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }> = [
    { type: 'text-delta', text: 'Hello' },
    { type: 'text-delta', text: ' CLI' },
    { type: 'finish', finishReason: 'stop' }
  ]

  public async *streamChat(
    _input: { messages: ReadonlyArray<{ role: ChatRole; content: string }> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  > {
    if (this.shouldFail) {
      const err = new Error(`Provider HTTP ${this.failureStatus}`)
      ;(err as unknown as { status: number }).status = this.failureStatus
      throw err
    }

    for (const chunk of this.chunks) {
      if (signal.aborted) return
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs))
      }
      if (signal.aborted) return
      yield chunk
    }
  }
}

describe('cli-runner', () => {
  const createBaseConfig = () => ({
    provider: 'openai-compatible' as const,
    baseUrl: 'https://fake-host.com/v1',
    apiKey: 'fake-key',
    modelId: 'fake-model',
    maxOutputTokens: 1024,
    providerConfig: {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://fake-host.com/v1',
      apiKey: 'fake-key',
      modelId: 'fake-model',
      maxOutputTokens: 1024
    },
    prompt: 'Hello from test',
    timeoutMs: 5000,
    format: 'text' as const,
    noColor: true
  })

  it('should run full started/delta/completed flow and return exit code 0', async () => {
    let stdoutText = ''
    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: (t) => { stdoutText += t },
      stderr: () => {}
    })

    const fakeModel = new FakeCliModel()
    const kernel = new ChatKernel(fakeModel)

    const result = await runCli({
      config: createBaseConfig(),
      output,
      customKernel: kernel
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    expect(stdoutText).toBe('Hello CLI\n')
  })

  it('should handle SIGINT interruption and return exit code 130', async () => {
    const fakeModel = new FakeCliModel()
    fakeModel.delayMs = 100
    const kernel = new ChatKernel(fakeModel)

    const signalTarget = new EventEmitter()
    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: () => {},
      stderr: () => {}
    })

    const runPromise = runCli({
      config: createBaseConfig(),
      output,
      customKernel: kernel,
      signalTarget
    })

    // Emit SIGINT after 20ms
    setTimeout(() => {
      signalTarget.emit('SIGINT')
    }, 20)

    const result = await runPromise
    expect(result.exitCode).toBe(CLI_EXIT_CODES.INTERRUPTED)
  })

  it('should handle request timeout and return exit code 6', async () => {
    const fakeModel = new FakeCliModel()
    fakeModel.delayMs = 80
    const kernel = new ChatKernel(fakeModel)

    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: () => {},
      stderr: () => {}
    })

    const config = {
      ...createBaseConfig(),
      timeoutMs: 20 // Shorter than model delay
    }

    const result = await runCli({
      config,
      output,
      customKernel: kernel
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.REQUEST_TIMEOUT)
  })

  it('should map model 401 error to PROVIDER_UNAUTHORIZED exit code', async () => {
    const fakeModel = new FakeCliModel()
    fakeModel.shouldFail = true
    fakeModel.failureStatus = 401
    const kernel = new ChatKernel(fakeModel)

    let stderrText = ''
    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: () => {},
      stderr: (t) => { stderrText += t }
    })

    const result = await runCli({
      config: createBaseConfig(),
      output,
      customKernel: kernel
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.PROVIDER_UNAUTHORIZED)
    expect(stderrText).toContain('PROVIDER_UNAUTHORIZED')
  })

  it('should map model 429 error to PROVIDER_RATE_LIMITED exit code', async () => {
    const fakeModel = new FakeCliModel()
    fakeModel.shouldFail = true
    fakeModel.failureStatus = 429
    const kernel = new ChatKernel(fakeModel)

    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: () => {},
      stderr: () => {}
    })

    const result = await runCli({
      config: createBaseConfig(),
      output,
      customKernel: kernel
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.PROVIDER_RATE_LIMITED)
  })

  it('should map model 503 error to PROVIDER_UNAVAILABLE exit code', async () => {
    const fakeModel = new FakeCliModel()
    fakeModel.shouldFail = true
    fakeModel.failureStatus = 503
    const kernel = new ChatKernel(fakeModel)

    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: () => {},
      stderr: () => {}
    })

    const result = await runCli({
      config: createBaseConfig(),
      output,
      customKernel: kernel
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.PROVIDER_UNAVAILABLE)
  })

  it('should initialize ChatKernel via createModelAdapter when customKernel is not provided', async () => {
    const ssePayload = 'data: {"choices":[{"delta":{"content":"Hi from factory"}}]}\n\ndata: [DONE]\n\n'
    const mockResponse = new Response(ssePayload, { status: 200 })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    let stdoutText = ''
    const output = new CliOutputHandler('text', 'fake-key', true, {
      stdout: (t) => { stdoutText += t },
      stderr: () => {}
    })

    const result = await runCli({
      config: createBaseConfig(),
      output
    })

    expect(result.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
    expect(stdoutText).toBe('Hi from factory\n')
    fetchSpy.mockRestore()
  })
})
