import * as readline from 'node:readline'
import { ChatKernel } from 'chat-core'
import {
  ConversationRuntimeService,
  type StreamingChatExecutor
} from 'chat-conversation-runtime'
import {
  ConversationTreeService,
  InMemoryConversationTreeRepository
} from 'chat-conversation-tree'
import { createModelAdapter } from 'chat-model-adapters'
import type { TestCliConfig } from './cli-config.js'
import { CLI_EXIT_CODES, type CliExitCode } from './cli-exit-codes.js'
import type { CliOutputHandler } from './cli-output.js'
import {
  getSessionHelpText,
  parseSessionCommand
} from './session-command.parser.js'

export interface RunSessionCliOptions {
  config: TestCliConfig
  output: CliOutputHandler
  customTreeService?: ConversationTreeService
  customRuntimeService?: ConversationRuntimeService
  customKernel?: StreamingChatExecutor
  input?: NodeJS.ReadableStream
  outputStream?: NodeJS.WritableStream
  signalTarget?: NodeJS.EventEmitter
}

export interface RunSessionCliResult {
  exitCode: CliExitCode
}

export async function runSessionCli(options: RunSessionCliOptions): Promise<RunSessionCliResult> {
  const {
    config,
    output,
    customTreeService,
    customRuntimeService,
    customKernel,
    input = process.stdin,
    outputStream = process.stdout,
    signalTarget = process
  } = options

  const treeRepo = new InMemoryConversationTreeRepository()
  const treeService = customTreeService ?? new ConversationTreeService(treeRepo)
  const runtimeService = customRuntimeService ?? new ConversationRuntimeService(treeService)

  const executor: StreamingChatExecutor =
    customKernel ??
    new ChatKernel(createModelAdapter(config.providerConfig))

  const treeId = config.treeId ?? `tree-${Date.now()}`

  output.writeDiagnostic(`Starting interactive session for tree "${treeId}". Provider: ${config.provider}, Model: ${config.modelId}`)
  output.writeDiagnostic('Type message to send, or /help for commands, /quit to exit.')

  const rl = readline.createInterface({
    input,
    output: outputStream,
    prompt: '> ',
    terminal: Boolean((input as { isTTY?: boolean }).isTTY)
  })

  let isTurnInProgress = false
  let isClosed = false
  let turnTimeout: NodeJS.Timeout | undefined

  return new Promise<RunSessionCliResult>((resolve) => {
    const clearTurnTimeout = () => {
      if (turnTimeout) {
        clearTimeout(turnTimeout)
        turnTimeout = undefined
      }
    }

    const finish = (exitCode: CliExitCode) => {
      if (isClosed) return
      isClosed = true
      clearTurnTimeout()
      cleanupSignals()
      rl.close()
      resolve({ exitCode })
    }

    const handleSigint = () => {
      if (isTurnInProgress) {
        output.writeCancelNotice()
        void runtimeService.cancelTurn({ treeId })
      } else {
        output.writeDiagnostic('Interrupted. Exiting interactive session.')
        finish(CLI_EXIT_CODES.INTERRUPTED)
      }
    }

    const cleanupSignals = () => {
      signalTarget.removeListener('SIGINT', handleSigint)
    }

    signalTarget.on('SIGINT', handleSigint)

    const promptUser = () => {
      if (!isClosed) {
        rl.prompt()
      }
    }

    rl.on('line', (line: string) => {
      const cmd = parseSessionCommand(line)

      if (cmd.type === 'empty') {
        promptUser()
        return
      }

      if (cmd.type === 'quit') {
        output.writeDiagnostic('Session ended by user.')
        finish(CLI_EXIT_CODES.SUCCESS)
        return
      }

      if (cmd.type === 'help') {
        output.writeRaw(getSessionHelpText() + '\n')
        promptUser()
        return
      }

      if (cmd.type === 'cancel') {
        if (!isTurnInProgress) {
          output.writeDiagnostic('No active turn in progress to cancel.')
        } else {
          output.writeCancelNotice()
          void runtimeService.cancelTurn({ treeId })
        }
        promptUser()
        return
      }

      if (isTurnInProgress) {
        output.writeDiagnostic('A turn is currently in progress. Type /cancel to abort the request.')
        promptUser()
        return
      }

      if (cmd.type === 'unknown') {
        output.writeError(cmd.error)
        promptUser()
        return
      }

      if (cmd.type === 'tree') {
        void (async () => {
          const treeRes = await treeService.getTree(treeId)
          if (!treeRes.ok) {
            output.writeDiagnostic(`Tree "${treeId}" is empty (no messages sent yet).`)
          } else {
            const curRes = await runtimeService.getCurrentNode(treeId)
            const currentId = curRes.ok ? curRes.value.id : treeRes.value.rootId
            output.writeTree(treeRes.value, currentId, config.treeContentWidth)
          }
          promptUser()
        })()
        return
      }

      if (cmd.type === 'current') {
        void (async () => {
          const curRes = await runtimeService.getCurrentNode(treeId)
          if (!curRes.ok) {
            output.writeDiagnostic(`No current node in tree "${treeId}" (no messages sent yet).`)
          } else {
            const node = curRes.value
            output.writeDiagnostic(`Tree: ${treeId}\nNode: ${node.id} [${node.role}] sequence=${node.sequence}\nContent: "${node.content.slice(0, 100)}"`)
          }
          promptUser()
        })()
        return
      }

      if (cmd.type === 'select') {
        void (async () => {
          const selRes = await runtimeService.selectNode({ treeId, nodeId: cmd.nodeId })
          if (!selRes.ok) {
            output.writeError(`Failed to select node: ${selRes.error.message}`)
          } else {
            output.writeDiagnostic(`Selected node: ${cmd.nodeId}`)
          }
          promptUser()
        })()
        return
      }

      if (cmd.type === 'path') {
        void (async () => {
          const curRes = await runtimeService.getCurrentNode(treeId)
          if (!curRes.ok) {
            output.writeDiagnostic(`No path available in tree "${treeId}".`)
          } else {
            const pathRes = await treeService.getPathToNode(treeId, curRes.value.id)
            if (!pathRes.ok) {
              output.writeError(`Failed to get path: ${pathRes.error.message}`)
            } else {
              const pathStr = pathRes.value.map((n) => `${n.id}[${n.role}]`).join(' -> ')
              output.writeDiagnostic(`Path: ${pathStr}`)
            }
          }
          promptUser()
        })()
        return
      }

      if (cmd.type === 'leaves') {
        void (async () => {
          const leavesRes = await treeService.listLeaves(treeId)
          if (!leavesRes.ok || leavesRes.value.length === 0) {
            output.writeDiagnostic(`No leaves found in tree "${treeId}".`)
          } else {
            const leafIds = leavesRes.value.map((l) => l.id).join(', ')
            output.writeDiagnostic(`Leaves: ${leafIds}`)
          }
          promptUser()
        })()
        return
      }

      if (cmd.type === 'branches') {
        void (async () => {
          const branchRes = await treeService.listBranches(treeId)
          if (!branchRes.ok || branchRes.value.length === 0) {
            output.writeDiagnostic(`No branches found in tree "${treeId}".`)
          } else {
            output.writeDiagnostic(`Branches (${branchRes.value.length}):`)
            for (const b of branchRes.value) {
              output.writeDiagnostic(`  Leaf: ${b.leafNodeId} -> [${b.nodeIds.join(' -> ')}]`)
            }
          }
          promptUser()
        })()
        return
      }

      if (cmd.type === 'send') {
        isTurnInProgress = true

        if (config.timeoutMs > 0) {
          turnTimeout = setTimeout(() => {
            if (isClosed || !isTurnInProgress) return
            output.writeError(`Request timed out after ${config.timeoutMs}ms`)
            void runtimeService.cancelTurn({ treeId })
          }, config.timeoutMs)
        }

        void runtimeService
          .sendMessage(
            {
              treeId,
              prompt: cmd.text,
              model: {
                providerId: config.provider,
                modelId: config.modelId,
                executor
              }
            },
            {
              emit: (turnEvent) => {
                output.handleTurnEvent(turnEvent)
              }
            }
          )
          .then(async (turnRes) => {
            isTurnInProgress = false
            clearTurnTimeout()

            if (turnRes.ok) {
              if (config.showTree) {
                const tRes = await treeService.getTree(treeId)
                if (tRes.ok) {
                  output.writeTree(tRes.value, turnRes.value.currentNodeId, config.treeContentWidth)
                }
              }
            } else {
              output.writeError(`Turn failed: ${turnRes.error.message} (${turnRes.error.code})`)
            }
            promptUser()
          })
          .catch((err: unknown) => {
            isTurnInProgress = false
            clearTurnTimeout()
            const msg = err instanceof Error ? err.message : String(err)
            output.writeError(`Unexpected turn error: ${msg}`)
            promptUser()
          })
      }
    })

    rl.on('close', () => {
      finish(CLI_EXIT_CODES.SUCCESS)
    })

    promptUser()
  })
}
