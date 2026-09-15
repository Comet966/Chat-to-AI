import { ChatKernel } from 'chat-core'
import { OpenAICompatibleModelAdapter } from 'chat-model-adapters'
import type { ChatEvent, StartChatCommand } from 'chat-contracts'
import { CLI_EXIT_CODES, type CliExitCode } from './cli-exit-codes.js'
import type { TestCliConfig } from './cli-config.js'
import type { CliOutputHandler } from './cli-output.js'

export interface RunCliOptions {
  config: TestCliConfig
  output: CliOutputHandler
  customKernel?: ChatKernel
  signalTarget?: NodeJS.EventEmitter
}

export interface RunCliResult {
  exitCode: CliExitCode
}

export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const { config, output, customKernel, signalTarget = process } = options

  const modelAdapter = new OpenAICompatibleModelAdapter({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelId: config.modelId
  })

  const kernel = customKernel ?? new ChatKernel(modelAdapter)

  const timestamp = Date.now()
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  const conversationId = `conv-${timestamp}-${randomSuffix}`
  const requestId = `req-${timestamp}-${randomSuffix}`
  const assistantMessageId = `asst-${timestamp}-${randomSuffix}`

  let hasFinalized = false
  let isTimeout = false
  let isInterrupted = false
  let timeoutTimer: NodeJS.Timeout | null = null

  return new Promise<RunCliResult>((resolve) => {
    const finalize = (exitCode: CliExitCode) => {
      if (hasFinalized) {
        return
      }
      hasFinalized = true

      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }

      cleanupSignals()
      resolve({ exitCode })
    }

    const handleSigint = () => {
      isInterrupted = true
      output.writeCancelNotice()
      void kernel.cancel({ requestId })
    }

    const handleSigterm = () => {
      isInterrupted = true
      output.writeCancelNotice()
      void kernel.cancel({ requestId })
    }

    const setupSignals = () => {
      signalTarget.on('SIGINT', handleSigint)
      signalTarget.on('SIGTERM', handleSigterm)
    }

    const cleanupSignals = () => {
      signalTarget.removeListener('SIGINT', handleSigint)
      signalTarget.removeListener('SIGTERM', handleSigterm)
    }

    setupSignals()

    if (config.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        isTimeout = true
        output.writeError(`Request timed out after ${config.timeoutMs}ms`)
        void kernel.cancel({ requestId })
      }, config.timeoutMs)
    }

    const sink = {
      emit: (event: ChatEvent) => {
        output.handleEvent(event)

        if (event.type === 'chat.stream.completed') {
          finalize(CLI_EXIT_CODES.SUCCESS)
        } else if (event.type === 'chat.stream.cancelled') {
          if (isTimeout) {
            finalize(CLI_EXIT_CODES.REQUEST_TIMEOUT)
          } else {
            finalize(CLI_EXIT_CODES.INTERRUPTED)
          }
        } else if (event.type === 'chat.stream.failed') {
          output.writeError(`Model request failed: ${event.error.message} (${event.error.code})`)
          finalize(mapChatErrorCodeToExitCode(event.error.code))
        }
      }
    }

    const command: StartChatCommand = {
      requestId,
      conversationId,
      assistantMessageId,
      messages: [{ role: 'user', content: config.prompt }]
    }

    void kernel.start(command, sink).then((result) => {
      if (!result.accepted) {
        output.writeError(`Kernel rejected request: ${result.error.message} (${result.error.code})`)
        finalize(mapChatErrorCodeToExitCode(result.error.code))
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      output.writeError(`Unexpected startup error: ${msg}`)
      finalize(CLI_EXIT_CODES.UNKNOWN_ERROR)
    })
  })
}

export function mapChatErrorCodeToExitCode(code: string): CliExitCode {
  switch (code) {
    case 'PROVIDER_UNAUTHORIZED':
      return CLI_EXIT_CODES.PROVIDER_UNAUTHORIZED
    case 'PROVIDER_RATE_LIMITED':
      return CLI_EXIT_CODES.PROVIDER_RATE_LIMITED
    case 'PROVIDER_UNAVAILABLE':
      return CLI_EXIT_CODES.PROVIDER_UNAVAILABLE
    case 'REQUEST_ABORTED':
      return CLI_EXIT_CODES.INTERRUPTED
    case 'INVALID_REQUEST':
      return CLI_EXIT_CODES.INVALID_ARGUMENTS
    default:
      return CLI_EXIT_CODES.UNKNOWN_ERROR
  }
}
