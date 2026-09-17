import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ConversationRuntimeService,
  InMemoryConversationCursorStore
} from 'chat-conversation-runtime'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'
import type { TestCliConfig } from '../../apps/test-cli/src/cli-config.js'
import { CLI_EXIT_CODES } from '../../apps/test-cli/src/cli-exit-codes.js'
import { CliOutputHandler } from '../../apps/test-cli/src/cli-output.js'
import { runSessionCli } from '../../apps/test-cli/src/session-cli-runner.js'
import {
  DeferredStreamingChatExecutor,
  ScriptedStreamingChatExecutor
} from '../conversation-runtime/test-helpers.js'

describe('session-cli-runner', () => {
  const createTestConfig = (overrides?: Partial<TestCliConfig>): TestCliConfig => ({
    provider: 'openai-compatible',
    baseUrl: 'https://fake-api.com/v1',
    apiKey: 'sk-test',
    modelId: 'test-model',
    maxOutputTokens: 1024,
    providerConfig: {
      provider: 'openai-compatible',
      baseUrl: 'https://fake-api.com/v1',
      apiKey: 'sk-test',
      modelId: 'test-model',
      maxOutputTokens: 1024
    },
    prompt: '',
    timeoutMs: 5000,
    format: 'text',
    noColor: true,
    interactive: true,
    treeId: 'session-test-tree',
    showTree: false,
    treeContentWidth: 40,
    ...overrides
  })

  it('should run interactive REPL session processing messages and slash commands', async () => {
    let stdoutText = ''
    let stderrText = ''

    const output = new CliOutputHandler('text', 'sk-test', true, {
      stdout: (t) => { stdoutText += t },
      stderr: (t) => { stderrText += t }
    })

    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Hello from scripted model!' },
      { type: 'completed', finishReason: 'stop' }
    ])

    const inputStream = new PassThrough()
    const outputStream = new PassThrough()

    const sessionPromise = runSessionCli({
      config: createTestConfig({ showTree: true }),
      output,
      customTreeService: treeService,
      customRuntimeService: runtimeService,
      customKernel: executor,
      input: inputStream,
      outputStream
    })

    // 1. Send first message
    inputStream.write('First prompt\n')

    // Wait for stream to complete
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 2. Query /current, /path, /leaves, /branches, /tree
    inputStream.write('/current\n')
    inputStream.write('/path\n')
    inputStream.write('/leaves\n')
    inputStream.write('/branches\n')
    inputStream.write('/tree\n')

    // Wait a tick
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 3. /quit
    inputStream.write('/quit\n')

    const res = await sessionPromise
    expect(res.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)

    // Verify stdout received streaming delta
    expect(stdoutText).toContain('Hello from scripted model!')

    // Verify diagnostic logs contain tree & path outputs
    expect(stderrText).toContain('Tree: session-test-tree')
    expect(stderrText).toContain('Leaves:')
    expect(stderrText).toContain('Branches (1):')
  })

  it('should support /select to switch nodes and branch interactively', async () => {
    const output = new CliOutputHandler('text', 'sk-test', true, {
      stdout: () => {},
      stderr: () => {}
    })

    const treeRepo = new InMemoryConversationTreeRepository()
    const treeService = new ConversationTreeService(treeRepo)
    const cursorStore = new InMemoryConversationCursorStore()
    const runtimeService = new ConversationRuntimeService(treeService, cursorStore)

    const executor = new ScriptedStreamingChatExecutor([
      { type: 'started' },
      { type: 'delta', text: 'Ans' },
      { type: 'completed', finishReason: 'stop' }
    ])

    const inputStream = new PassThrough()
    const outputStream = new PassThrough()

    const sessionPromise = runSessionCli({
      config: createTestConfig(),
      output,
      customTreeService: treeService,
      customRuntimeService: runtimeService,
      customKernel: executor,
      input: inputStream,
      outputStream
    })

    // Turn 1: create root
    inputStream.write('Root prompt\n')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const tree = (await treeService.getTree('session-test-tree')).value!
    const rootId = tree.rootId

    // Select root
    inputStream.write(`/select ${rootId}\n`)
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Send another prompt from root (creating a branch)
    inputStream.write('Second prompt from root\n')
    await new Promise((resolve) => setTimeout(resolve, 50))

    inputStream.write('/quit\n')
    const res = await sessionPromise
    expect(res.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)

    // Verify tree has 2 branches now
    const branches = (await treeService.listBranches('session-test-tree')).value!
    expect(branches).toHaveLength(2)
  })

  it('should cancel an active turn when the configured timeout elapses', async () => {
    let stderrText = ''
    const output = new CliOutputHandler('text', 'sk-test', true, {
      stdout: () => {},
      stderr: (text) => { stderrText += text }
    })
    const treeService = new ConversationTreeService(new InMemoryConversationTreeRepository())
    const runtimeService = new ConversationRuntimeService(treeService)
    const executor = new DeferredStreamingChatExecutor()
    const inputStream = new PassThrough()
    const outputStream = new PassThrough()

    const sessionPromise = runSessionCli({
      config: createTestConfig({ timeoutMs: 20 }),
      output,
      customTreeService: treeService,
      customRuntimeService: runtimeService,
      customKernel: executor,
      input: inputStream,
      outputStream
    })

    inputStream.write('A request that should time out\n')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(executor.cancelCalled).toBe(true)
    expect(stderrText).toContain('Request timed out after 20ms')

    inputStream.write('/quit\n')
    const res = await sessionPromise
    expect(res.exitCode).toBe(CLI_EXIT_CODES.SUCCESS)
  })
})
