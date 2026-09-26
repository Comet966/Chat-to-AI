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

  public hasActiveTurn(treeId: ConversationTreeId): boolean {
    return this.activeTurnRegistry.hasActiveTurn(treeId)
  }

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
    let pendingUserNodeId: ConversationNodeId | null = null
    let pendingBaseNodeId: ConversationNodeId | null = null
    let pendingTreeVersion: number | null = null

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

      pendingUserNodeId = userNodeId
      pendingBaseNodeId = baseNodeId
      pendingTreeVersion = expectedVersionAfterUser

      const contextNodesRes = await this.resolveContextNodes(
        command,
        userNodeId,
        baseNodeId
      )
      if (!contextNodesRes.ok) {
        const rollbackRes = await this.rollbackPendingUser(
          command.treeId,
          userNodeId,
          baseNodeId,
          expectedVersionAfterUser
        )
        pendingUserNodeId = null
        pendingTreeVersion = null
        return rollbackRes.ok ? contextNodesRes : rollbackRes
      }

      const contextRes = buildChatContext(contextNodesRes.value)
      if (!contextRes.ok) {
        const rollbackRes = await this.rollbackPendingUser(
          command.treeId,
          userNodeId,
          baseNodeId,
          expectedVersionAfterUser
        )
        pendingUserNodeId = null
        pendingTreeVersion = null
        return rollbackRes.ok ? contextRes : rollbackRes
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

      const finishUnsuccessfulTurn = async (
        error: ReturnType<typeof createRuntimeError>,
        terminalEvent: 'failed' | 'cancelled'
      ): Promise<void> => {
        const rollbackRes = await this.rollbackPendingUser(
          command.treeId,
          userNodeId,
          baseNodeId,
          expectedVersionAfterUser
        )
        pendingUserNodeId = null
        pendingTreeVersion = null
        this.activeTurnRegistry.release(command.treeId, requestId)

        if (!rollbackRes.ok) {
          sink.emit({
            type: 'conversation.turn.failed',
            treeId: command.treeId,
            requestId,
            userNodeId,
            error: rollbackRes.error
          })
          resolve(rollbackRes)
          return
        }

        if (terminalEvent === 'cancelled') {
          sink.emit({
            type: 'conversation.turn.cancelled',
            treeId: command.treeId,
            requestId,
            userNodeId
          })
        } else {
          sink.emit({
            type: 'conversation.turn.failed',
            treeId: command.treeId,
            requestId,
            userNodeId,
            error
          })
        }
        resolve({ ok: false, error })
      }

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
              const err = createRuntimeError(
                'EMPTY_MODEL_RESPONSE',
                'Model returned empty response content'
              )
              void finishUnsuccessfulTurn(err, 'failed')
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
              .then(async (appendAssistantRes) => {
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
                  const rollbackRes = await this.rollbackPendingUser(
                    command.treeId,
                    userNodeId,
                    baseNodeId,
                    expectedVersionAfterUser
                  )
                  pendingUserNodeId = null
                  pendingTreeVersion = null
                  const finalError = rollbackRes.ok ? err : rollbackRes.error
                  this.activeTurnRegistry.release(command.treeId, requestId)
                  sink.emit({
                    type: 'conversation.turn.failed',
                    treeId: command.treeId,
                    requestId,
                    userNodeId,
                    error: finalError
                  })
                  resolve({ ok: false, error: finalError })
                  return
                }

                const finalTreeVersion = appendAssistantRes.value.version
                this.cursorStore.set(command.treeId, assistantNodeId)
                pendingUserNodeId = null
                pendingTreeVersion = null
                this.activeTurnRegistry.release(command.treeId, requestId)

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
            void finishUnsuccessfulTurn(
              createRuntimeError('MODEL_REQUEST_CANCELLED', 'Model request was cancelled'),
              'cancelled'
            )
          } else if (event.type === 'chat.stream.failed') {
            if (terminalHandled) return
            terminalHandled = true

            const err = createRuntimeError(
              'MODEL_REQUEST_FAILED',
              event.error.message,
              event.error as unknown as Record<string, unknown>
            )
            void finishUnsuccessfulTurn(err, 'failed')
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
            const err = createRuntimeError(
              'MODEL_REQUEST_REJECTED',
              `Model request was rejected: ${startRes.error.message}`,
              startRes.error as unknown as Record<string, unknown>
            )
            void finishUnsuccessfulTurn(err, 'failed')
          }
        })
        .catch((err: unknown) => {
          if (terminalHandled) return
          terminalHandled = true
          const msg = err instanceof Error ? err.message : String(err)
          const runtimeErr = createRuntimeError(
            'INTERNAL_ERROR',
            `Unexpected error starting model stream: ${msg}`
          )
          void finishUnsuccessfulTurn(runtimeErr, 'failed')
        })
      })
    } catch (err: unknown) {
      if (pendingUserNodeId && pendingTreeVersion !== null) {
        const rollbackRes = await this.rollbackPendingUser(
          command.treeId,
          pendingUserNodeId,
          pendingBaseNodeId,
          pendingTreeVersion
        )
        if (!rollbackRes.ok) {
          return rollbackRes
        }
      }
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

  private async resolveContextNodes(
    command: SendConversationMessageCommand,
    userNodeId: ConversationNodeId,
    baseNodeId: ConversationNodeId | null
  ): Promise<ConversationRuntimeResult<readonly ConversationNode[]>> {
    const selection = command.contextSelection ?? { mode: 'root-path' as const }

    if (selection.mode === 'root-path') {
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
      return pathRes
    }

    if (new Set(selection.nodeIds).size !== selection.nodeIds.length) {
      return {
        ok: false,
        error: createRuntimeError(
          'INVALID_CONTEXT_SELECTION',
          'Explicit context node IDs must not contain duplicates'
        )
      }
    }

    if (selection.nodeIds.length === 0 && baseNodeId !== null) {
      return {
        ok: false,
        error: createRuntimeError(
          'INVALID_CONTEXT_SELECTION',
          'Explicit context must include at least one complete conversation turn'
        )
      }
    }

    if (selection.nodeIds.length % 2 !== 0) {
      return {
        ok: false,
        error: createRuntimeError(
          'INVALID_CONTEXT_SELECTION',
          'Explicit context must contain complete user and assistant message pairs'
        )
      }
    }

    const nodes: ConversationNode[] = []
    for (const nodeId of selection.nodeIds) {
      const nodeRes = await this.treeService.getNode(command.treeId, nodeId)
      if (!nodeRes.ok) {
        return {
          ok: false,
          error: createRuntimeError(
            'NODE_NOT_FOUND',
            `Context node "${nodeId}" not found in tree "${command.treeId}"`
          )
        }
      }
      nodes.push(nodeRes.value)
    }

    for (let index = 0; index < nodes.length; index += 2) {
      const userNode = nodes[index]
      const assistantNode = nodes[index + 1]
      if (
        userNode.role !== 'user' ||
        assistantNode.role !== 'assistant' ||
        assistantNode.parentId !== userNode.id
      ) {
        return {
          ok: false,
          error: createRuntimeError(
            'INVALID_CONTEXT_SELECTION',
            'Explicit context must be an ordered list of complete user and assistant pairs'
          )
        }
      }
    }

    const promptNodeRes = await this.treeService.getNode(command.treeId, userNodeId)
    if (!promptNodeRes.ok) {
      return {
        ok: false,
        error: createRuntimeError(
          'INTERNAL_ERROR',
          `Failed to read current prompt node "${userNodeId}"`
        )
      }
    }

    return { ok: true, value: [...nodes, promptNodeRes.value] }
  }

  private async rollbackPendingUser(
    treeId: ConversationTreeId,
    userNodeId: ConversationNodeId,
    baseNodeId: ConversationNodeId | null,
    expectedVersion: number
  ): Promise<ConversationRuntimeResult<void>> {
    if (baseNodeId === null) {
      const deleteTreeRes = await this.treeService.deleteTree({ treeId, expectedVersion })
      if (!deleteTreeRes.ok) {
        return {
          ok: false,
          error: createRuntimeError(
            deleteTreeRes.error.code === 'VERSION_CONFLICT'
              ? 'TREE_VERSION_CONFLICT'
              : 'INTERNAL_ERROR',
            `Failed to roll back incomplete root turn: ${deleteTreeRes.error.message}`
          )
        }
      }
      this.cursorStore.delete(treeId)
      return { ok: true, value: undefined }
    }

    const deleteNodeRes = await this.treeService.deleteNode({
      treeId,
      expectedVersion,
      nodeId: userNodeId,
      mode: 'leaf-only'
    })
    if (!deleteNodeRes.ok) {
      return {
        ok: false,
        error: createRuntimeError(
          deleteNodeRes.error.code === 'VERSION_CONFLICT'
            ? 'TREE_VERSION_CONFLICT'
            : 'INTERNAL_ERROR',
          `Failed to roll back incomplete turn: ${deleteNodeRes.error.message}`
        )
      }
    }
    this.cursorStore.set(treeId, baseNodeId)
    return { ok: true, value: undefined }
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
