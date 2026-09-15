import { describe, expect, it } from 'vitest'
import { CliOutputHandler } from '../../apps/test-cli/src/cli-output.js'
import type { ChatEvent } from 'chat-contracts'

describe('cli-output', () => {
  it('should stream deltas to stdout and add trailing newline on completion in text mode', () => {
    let stdoutData = ''
    let stderrData = ''

    const output = new CliOutputHandler('text', 'secret-key', true, {
      stdout: (t) => { stdoutData += t },
      stderr: (t) => { stderrData += t }
    })

    const deltaEvent1: ChatEvent = {
      type: 'chat.stream.delta',
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      sequence: 0,
      delta: 'Hello',
      emittedAt: new Date().toISOString()
    }

    const deltaEvent2: ChatEvent = {
      type: 'chat.stream.delta',
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      sequence: 1,
      delta: ' world',
      emittedAt: new Date().toISOString()
    }

    const completedEvent: ChatEvent = {
      type: 'chat.stream.completed',
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      finishReason: 'stop',
      emittedAt: new Date().toISOString()
    }

    output.handleEvent(deltaEvent1)
    output.handleEvent(deltaEvent2)
    output.handleEvent(completedEvent)

    expect(stdoutData).toBe('Hello world\n')
    expect(stderrData).toBe('')
  })

  it('should format events as valid JSONL in jsonl mode', () => {
    let stdoutData = ''
    let stderrData = ''

    const output = new CliOutputHandler('jsonl', 'secret-key', true, {
      stdout: (t) => { stdoutData += t },
      stderr: (t) => { stderrData += t }
    })

    const startedEvent: ChatEvent = {
      type: 'chat.stream.started',
      requestId: 'req-1',
      conversationId: 'conv-1',
      assistantMessageId: 'asst-1',
      emittedAt: new Date().toISOString()
    }

    output.handleEvent(startedEvent)

    expect(stdoutData.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(stdoutData.trim())
    expect(parsed.type).toBe('chat.stream.started')
    expect(parsed.requestId).toBe('req-1')
    expect(stderrData).toBe('')
  })

  it('should write diagnostics and errors to stderr with secret redacted', () => {
    let stdoutData = ''
    let stderrData = ''
    const secret = 'super-secret-key'

    const output = new CliOutputHandler('text', secret, true, {
      stdout: (t) => { stdoutData += t },
      stderr: (t) => { stderrData += t }
    })

    output.writeDiagnostic(`Connecting with ${secret}`)
    output.writeError(`Failed auth for ${secret}`)

    expect(stdoutData).toBe('')
    expect(stderrData).not.toContain(secret)
    expect(stderrData).toContain('[REDACTED]')
    expect(stderrData).toContain('[info]')
    expect(stderrData).toContain('[error]')
  })
})
