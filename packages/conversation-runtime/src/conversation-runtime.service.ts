import type {
  ConversationNode,
  ConversationNodeId,
  ConversationTreeId,
  ConversationTreeService
} from 'chat-conversation-tree'
import { MAX_SINGLE_MESSAGE_LENGTH } from 'chat-contracts'
import { ActiveTurnRegistry } from './active-turn.registry.js'
import { buildChatContext } from './context-builder.js'
import {
  createRuntimeError,
  type ConversationRuntimeErrorCode
} from './domain/conversation-runtime.errors.js'
import type {
  ConversationTurnEventSink
} from './domain/conversation-runtime.events.js'
import type {
  CancelConversationTurnCommand,
  CompletedConversationTurn,
  ConversationCursor,
  ConversationRuntimeResult,
  SelectConversationNodeCommand,
  SendConversationMessageCommand
} from './domain/conversation-runtime.types.js'
import {
  InMemoryConversationCursorStore,
  type ConversationCursorStore
} from './ports/conversation-cursor-store.port.js'
import {
  DefaultConversationRuntimeIdGenerator,
  type ConversationRuntimeIdGenerator
} from './ports/runtime-id-generator.port.js'
import type { StreamingChatEventSink } from './ports/streaming-chat-executor.port.js'

export class ConversationRuntimeService {
  private readonly activeTurnRegistry = new ActiveTurnRegistry()

  constructor(
    private readonly treeService: ConversationTreeService,
    private readonly cursorStore: ConversationCursorStore = new InMemoryConversationCursorStore(),
    private readonly idGenerator: ConversationRuntimeIdGenerator = new DefaultConversationRuntimeIdGenerator()
  ) {}

  public async sendMessage(
    command: SendConversationMessageCommand,
    sink: ConversationTurnEventSink
  ): Promise<ConversationRuntimeResult<CompletedConversationTurn>> {
    if (!command.prompt || typeof command.prompt !== 'string' || command.prompt.trim() === '') {
      return {
        ok: false,
        error: createRuntimeError('INVALID_PROMPT', 'Prompt cannot be empty or whitespace only')
      }
    }

    if (command.prompt.length > MAX_SINGLE_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: createRuntimeError(
          'CONTEXT_LIMIT_EXCEEDED',
          `Prompt length ${command.prompt.length} exceeds limit of ${MAX_SINGLE_MESSAGE_LENGTH}`
        )
      }
    }

    const requestId = this.idGenerator.nextRequestId()
    if (!this.activeTurnRegistry.register(command.treeId, requestId, command.model.executor)) {
      return {
        ok: false,
        error: createRuntimeError(
          'TURN_IN_PROGRESS',
          `A conversation turn is already in progress for tree "${command.treeId}"`
        )
      }
    }

    let streamStarted = false

    try {
      let baseNodeId: ConversationNodeId | null = null
      let userNodeId: ConversationNodeId
      let expectedVersionAfterUser: number

      const getTreeRes = await this.treeService.getTree(command.treeId)

      if (!getTreeRes.ok) {
      if (getTreeRes.error.code === 'TREE_NOT_FOUND') {
        // First turn in a new tree: prompt becomes the user root
        userNodeId = this.idGenerator.nextUserNodeId()
        const createTreeRes = await this.treeService.createTree({
          treeId: command.treeId,
          root: {
            id: userNodeId,
            role: 'user',
            content: command.prompt
          }
        })

        if (!createTreeRes.ok) {
          return {
            ok: false,
            error: createRuntimeError(
              'INTERNAL_ERROR',
              `Failed to create conversation tree: ${createTreeRes.error.message}`,
              createTreeRes.error.details
            )
          }
        }

        baseNodeId = null
        expectedVersionAfterUser = createTreeRes.value.version
        this.cursorStore.set(command.treeId, userNodeId)
      } else {
        return {
          ok: false,
          error: createRuntimeError(
            'INTERNAL_ERROR',
            getTreeRes.error.message,
            getTreeRes.error.details
          )
        }
      }
      } else {
      // Tree already exists: append user node under base node
      const currentTree = getTreeRes.value

      if (command.selectedNodeId) {
        const checkNode = await this.treeService.getNode(command.treeId, command.selectedNodeId)
        if (!checkNode.ok) {
          return {
            ok: false,
            error: createRuntimeError(
              'NODE_NOT_FOUND',
              `Selected node "${command.selectedNodeId}" not found in tree "${command.treeId}"`
            )
          }
        }
        baseNodeId = command.selectedNodeId
      } else {
        const cursorNodeId = this.cursorStore.get(command.treeId)
        let resolvedBaseId: ConversationNodeId | null = null

        if (cursorNodeId) {
          const checkNode = await this.treeService.getNode(command.treeId, cursorNodeId)
          if (checkNode.ok) {
            resolvedBaseId = cursorNodeId
          }
        }

        if (!resolvedBaseId) {
          const leavesRes = await this.treeService.listLeaves(command.treeId)
          if (!leavesRes.ok || leavesRes.value.length === 0) {
            return {
              ok: false,
              error: createRuntimeError(
                'INTERNAL_ERROR',
                `No leaf nodes found in tree "${command.treeId}"`
              )
            }
          }
          const sortedLeaves = [...leavesRes.value].sort((a, b) => b.sequence - a.sequence)
          resolvedBaseId = sortedLeaves[0].id
        }

        baseNodeId = resolvedBaseId
      }

      userNodeId = this.idGenerator.nextUserNodeId()
      const appendUserRes = await this.treeService.appendNode({
        treeId: command.treeId,
        expectedVersion: currentTree.version,
        parentId: baseNodeId,
        node: {
          id: userNodeId,
          role: 'user',
          content: command.prompt
        }
      })

      if (!appendUserRes.ok) {
        const errCode: ConversationRuntimeErrorCode =
          appendUserRes.error.code === 'VERSION_CONFLICT'
            ? 'TREE_VERSION_CONFLICT'
            : 'INTERNAL_ERROR'
        return {
          ok: false,
          error: createRuntimeError(errCode, appendUserRes.error.message, appendUserRes.error.details)
        }
      }

      expectedVersionAfterUser = appendUserRes.value.version
      this.cursorStore.set(command.treeId, userNodeId)
      }

      // Retrieve unique root-to-user path
      const pathRes = await this.treeService.getPathToNode(command.treeId, userNodeId)
      if (!pathRes.ok) {
        return {
          ok: false,
          error: createRuntimeError(
            'INTERNAL_ERROR',
            `Failed to get path to node "${userNodeId}": ${pathRes.error.message}`
          )
        }
      }

      // Build chat context
      const contextRes = buildChatContext(pathRes.value)
      if (!contextRes.ok) {
        return contextRes
      }

      const assistantNodeId = this.idGenerator.nextAssistantNodeId()

      sink.emit({
        type: 'conversation.turn.started',
        treeId: command.treeId,
        requestId,
        userNodeId
      })

      streamStarted = true
      return new Promise<ConversationRuntimeResult<CompletedConversationTurn>>((resolve) => {
      let terminalHandled = false
      let accumulatedText = ''

      const executorSink: StreamingChatEventSink = {
        emit: (event) => {
          if (event.requestId !== requestId) {
            return
          }

          if (event.type === 'chat.stream.delta') {
            accumulatedText += event.delta
            sink.emit({
              type: 'conversation.turn.delta',
              treeId: command.treeId,
              requestId,
              userNodeId,
              assistantNodeId,
              sequence: event.sequence,
              delta: event.delta
            })
          } else if (event.type === 'chat.stream.completed') {
            if (terminalHandled) return
            terminalHandled = true

            if (accumulatedText.trim() === '') {
              this.activeTurnRegistry.release(command.treeId, requestId)
              const err = createRuntimeError(
                'EMPTY_MODEL_RESPONSE',
                'Model returned empty response content'
              )
              sink.emit({
                type: 'conversation.turn.failed',
                treeId: command.treeId,
                requestId,
                userNodeId,
                error: err
              })
              resolve({ ok: false, error: err })
              return
            }

            void this.treeService
              .appendNode({
                treeId: command.treeId,
                expectedVersion: expectedVersionAfterUser,
                parentId: userNodeId,
                node: {
                  id: assistantNodeId,
                  role: 'assistant',
                  content: accumulatedText,
                  generatedBy: {
                    providerId: command.model.providerId,
                    modelId: command.model.modelId
                  }
                }
              })
              .then((appendAssistantRes) => {
                this.activeTurnRegistry.release(command.treeId, requestId)

                if (!appendAssistantRes.ok) {
                  const errorCode: ConversationRuntimeErrorCode =
                    appendAssistantRes.error.code === 'VERSION_CONFLICT'
                      ? 'TREE_VERSION_CONFLICT'
                      : 'ASSISTANT_PERSIST_FAILED'
                  const err = createRuntimeError(
                    errorCode,
                    `Failed to persist assistant message to tree: ${appendAssistantRes.error.message}`,
                    appendAssistantRes.error.details
                  )
                  sink.emit({
                    type: 'conversation.turn.failed',
                    treeId: command.treeId,
                    requestId,
                    userNodeId,
                    error: err
                  })
                  resolve({ ok: false, error: err })
                  return
                }

                const finalTreeVersion = appendAssistantRes.value.version
                this.cursorStore.set(command.treeId, assistantNodeId)

                sink.emit({
                  type: 'conversation.turn.completed',
                  treeId: command.treeId,
                  requestId,
                  userNodeId,
                  assistantNodeId,
                  currentNodeId: assistantNodeId,
                  finishReason: event.finishReason,
                  treeVersion: finalTreeVersion
                })

                resolve({
                  ok: true,
                  value: {
                    treeId: command.treeId,
                    requestId,
                    baseNodeId,
                    userNodeId,
                    assistantNodeId,
                    currentNodeId: assistantNodeId,
                    finishReason: event.finishReason,
                    treeVersion: finalTreeVersion
                  }
                })
              })
          } else if (event.type === 'chat.stream.cancelled') {
            if (terminalHandled) return
            terminalHandled = true
            this.activeTurnRegistry.release(command.treeId, requestId)

            sink.emit({
              type: 'conversation.turn.cancelled',
              treeId: command.treeId,
              requestId,
              userNodeId
            })
            resolve({
              ok: false,
              error: createRuntimeError('MODEL_REQUEST_CANCELLED', 'Model request was cancelled')
            })
          } else if (event.type === 'chat.stream.failed') {
            if (terminalHandled) return
            terminalHandled = true
            this.activeTurnRegistry.release(command.treeId, requestId)

            const err = createRuntimeError(
              'MODEL_REQUEST_FAILED',
              event.error.message,
              event.error as unknown as Record<string, unknown>
            )
            sink.emit({
              type: 'conversation.turn.failed',
              treeId: command.treeId,
              requestId,
              userNodeId,
              error: err
            })
            resolve({ ok: false, error: err })
          }
        }
      }

      void command.model.executor
        .start(
          {
            requestId,
            conversationId: command.treeId,
            assistantMessageId: assistantNodeId,
            messages: contextRes.value
          },
          executorSink
        )
        .then((startRes) => {
          if (!startRes.accepted && !terminalHandled) {
            terminalHandled = true
            this.activeTurnRegistry.release(command.treeId, requestId)
            const err = createRuntimeError(
              'MODEL_REQUEST_REJECTED',
              `Model request was rejected: ${startRes.error.message}`,
              startRes.error as unknown as Record<string, unknown>
            )
            sink.emit({
              type: 'conversation.turn.failed',
              treeId: command.treeId,
              requestId,
              userNodeId,
              error: err
            })
            resolve({ ok: false, error: err })
          }
        })
        .catch((err: unknown) => {
          if (terminalHandled) return
          terminalHandled = true
          this.activeTurnRegistry.release(command.treeId, requestId)
          const msg = err instanceof Error ? err.message : String(err)
          const runtimeErr = createRuntimeError(
            'INTERNAL_ERROR',
            `Unexpected error starting model stream: ${msg}`
          )
          sink.emit({
            type: 'conversation.turn.failed',
            treeId: command.treeId,
            requestId,
            userNodeId,
            error: runtimeErr
          })
          resolve({ ok: false, error: runtimeErr })
        })
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        error: createRuntimeError('INTERNAL_ERROR', `Unexpected conversation runtime error: ${msg}`)
      }
    } finally {
      if (!streamStarted) {
        this.activeTurnRegistry.release(command.treeId, requestId)
      }
    }
  }

  public async selectNode(
    command: SelectConversationNodeCommand
  ): Promise<ConversationRuntimeResult<ConversationCursor>> {
    if (this.activeTurnRegistry.hasActiveTurn(command.treeId)) {
      return {
        ok: false,
        error: createRuntimeError(
          'TURN_IN_PROGRESS',
          `Cannot select node while a turn is in progress on tree "${command.treeId}"`
        )
      }
    }

    const treeRes = await this.treeService.getTree(command.treeId)
    if (!treeRes.ok) {
      return {
        ok: false,
        error: createRuntimeError(
          'TREE_NOT_FOUND',
          `Conversation tree "${command.treeId}" not found`
        )
      }
    }

    const nodeRes = await this.treeService.getNode(command.treeId, command.nodeId)
    if (!nodeRes.ok) {
      return {
        ok: false,
        error: createRuntimeError(
          'NODE_NOT_FOUND',
          `Node "${command.nodeId}" not found in tree "${command.treeId}"`
        )
      }
    }

    this.cursorStore.set(command.treeId, command.nodeId)

    return {
      ok: true,
      value: {
        treeId: command.treeId,
        currentNodeId: command.nodeId
      }
    }
  }

  public async getCurrentNode(
    treeId: ConversationTreeId
  ): Promise<ConversationRuntimeResult<ConversationNode>> {
    const treeRes = await this.treeService.getTree(treeId)
    if (!treeRes.ok) {
      return {
        ok: false,
        error: createRuntimeError('TREE_NOT_FOUND', `Conversation tree "${treeId}" not found`)
      }
    }

    const cursorId = this.cursorStore.get(treeId)
    if (cursorId) {
      const nodeRes = await this.treeService.getNode(treeId, cursorId)
      if (nodeRes.ok) {
        return nodeRes
      }
    }

    // Default to leaf with highest sequence
    const leavesRes = await this.treeService.listLeaves(treeId)
    if (!leavesRes.ok || leavesRes.value.length === 0) {
      return {
        ok: false,
        error: createRuntimeError('INTERNAL_ERROR', `No leaf nodes found in tree "${treeId}"`)
      }
    }

    const sortedLeaves = [...leavesRes.value].sort((a, b) => b.sequence - a.sequence)
    const defaultNode = sortedLeaves[0]
    this.cursorStore.set(treeId, defaultNode.id)

    return {
      ok: true,
      value: defaultNode
    }
  }

  public async cancelTurn(
    command: CancelConversationTurnCommand
  ): Promise<ConversationRuntimeResult<void>> {
    const activeTurn = this.activeTurnRegistry.getActiveTurn(command.treeId)
    if (!activeTurn) {
      return { ok: true, value: undefined }
    }

    await activeTurn.executor.cancel({ requestId: activeTurn.requestId })
    return { ok: true, value: undefined }
  }
}
