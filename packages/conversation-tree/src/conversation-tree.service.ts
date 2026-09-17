import type { AppendNodeCommand } from './commands/append-node.command.js'
import type { CreateTreeCommand } from './commands/create-tree.command.js'
import type { DeleteNodeCommand } from './commands/delete-node.command.js'
import type { DeleteTreeCommand } from './commands/delete-tree.command.js'
import type { ForkFromNodeCommand } from './commands/fork-from-node.command.js'
import {
  ConversationTree,
  type DeleteNodesResult
} from './conversation-tree.js'
import type { ConversationNode } from './domain/conversation-node.js'
import { createTreeError } from './domain/conversation-tree.errors.js'
import type {
  ConversationBranch,
  ConversationTreeDescriptor,
  ConversationTreeSnapshot
} from './domain/conversation-tree.snapshot.js'
import type {
  ConversationNodeId,
  ConversationTreeId,
  ConversationTreeResult
} from './domain/conversation-tree.types.js'
import { systemClock, type Clock } from './ports/clock.port.js'
import type { ConversationTreeRepository } from './ports/conversation-tree.repository.js'

export class ConversationTreeService {
  constructor(
    private readonly repository: ConversationTreeRepository,
    private readonly clock: Clock = systemClock
  ) {}

  public async createTree(
    command: CreateTreeCommand
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const createResult = ConversationTree.create(command, this.clock)
    if (!createResult.ok) {
      return createResult
    }

    const snapshot = createResult.value.toSnapshot()
    const repoResult = await this.repository.create(snapshot)
    if (!repoResult.ok) {
      return repoResult
    }

    return {
      ok: true,
      value: snapshot
    }
  }

  public async appendNode(
    command: AppendNodeCommand
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const loadResult = await this.repository.load(command.treeId)
    if (!loadResult.ok) {
      return loadResult
    }

    if (loadResult.value.version !== command.expectedVersion) {
      return {
        ok: false,
        error: createTreeError(
          'VERSION_CONFLICT',
          `Version conflict on tree "${command.treeId}": expected ${command.expectedVersion}, found ${loadResult.value.version}`
        )
      }
    }

    const hydrateResult = ConversationTree.hydrate(loadResult.value)
    if (!hydrateResult.ok) {
      return hydrateResult
    }
    const tree = hydrateResult.value

    const appendResult = tree.appendNode({ parentId: command.parentId, node: command.node }, this.clock)
    if (!appendResult.ok) {
      return appendResult
    }

    const snapshot = tree.toSnapshot()
    const saveResult = await this.repository.save(snapshot, command.expectedVersion)
    if (!saveResult.ok) {
      return saveResult
    }

    return {
      ok: true,
      value: snapshot
    }
  }

  public async forkFromNode(
    command: ForkFromNodeCommand
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    const loadResult = await this.repository.load(command.treeId)
    if (!loadResult.ok) {
      return loadResult
    }

    if (loadResult.value.version !== command.expectedVersion) {
      return {
        ok: false,
        error: createTreeError(
          'VERSION_CONFLICT',
          `Version conflict on tree "${command.treeId}": expected ${command.expectedVersion}, found ${loadResult.value.version}`
        )
      }
    }

    const hydrateResult = ConversationTree.hydrate(loadResult.value)
    if (!hydrateResult.ok) {
      return hydrateResult
    }
    const tree = hydrateResult.value

    const forkResult = tree.forkFromNode({ parentId: command.parentId, node: command.node }, this.clock)
    if (!forkResult.ok) {
      return forkResult
    }

    const snapshot = tree.toSnapshot()
    const saveResult = await this.repository.save(snapshot, command.expectedVersion)
    if (!saveResult.ok) {
      return saveResult
    }

    return {
      ok: true,
      value: snapshot
    }
  }

  public async deleteNode(
    command: DeleteNodeCommand
  ): Promise<ConversationTreeResult<DeleteNodesResult>> {
    const loadResult = await this.repository.load(command.treeId)
    if (!loadResult.ok) {
      return loadResult
    }

    if (loadResult.value.version !== command.expectedVersion) {
      return {
        ok: false,
        error: createTreeError(
          'VERSION_CONFLICT',
          `Version conflict on tree "${command.treeId}": expected ${command.expectedVersion}, found ${loadResult.value.version}`
        )
      }
    }

    const hydrateResult = ConversationTree.hydrate(loadResult.value)
    if (!hydrateResult.ok) {
      return hydrateResult
    }
    const tree = hydrateResult.value

    const deleteResult = tree.deleteNode(
      { nodeId: command.nodeId, mode: command.mode },
      this.clock
    )
    if (!deleteResult.ok) {
      return deleteResult
    }

    const saveResult = await this.repository.save(tree.toSnapshot(), command.expectedVersion)
    if (!saveResult.ok) {
      return saveResult
    }

    return {
      ok: true,
      value: deleteResult.value
    }
  }

  public async deleteTree(
    command: DeleteTreeCommand
  ): Promise<ConversationTreeResult<void>> {
    return this.repository.delete(command.treeId, command.expectedVersion)
  }

  public async getTree(
    treeId: ConversationTreeId
  ): Promise<ConversationTreeResult<ConversationTreeSnapshot>> {
    return this.repository.load(treeId)
  }

  public async getNode(
    treeId: ConversationTreeId,
    nodeId: ConversationNodeId
  ): Promise<ConversationTreeResult<ConversationNode>> {
    const treeRes = await this.loadAndHydrate(treeId)
    if (!treeRes.ok) {
      return treeRes
    }
    return treeRes.value.getNode(nodeId)
  }

  public async getPathToNode(
    treeId: ConversationTreeId,
    nodeId: ConversationNodeId
  ): Promise<ConversationTreeResult<readonly ConversationNode[]>> {
    const treeRes = await this.loadAndHydrate(treeId)
    if (!treeRes.ok) {
      return treeRes
    }
    return treeRes.value.getPathToNode(nodeId)
  }

  public async getChildren(
    treeId: ConversationTreeId,
    nodeId: ConversationNodeId
  ): Promise<ConversationTreeResult<readonly ConversationNode[]>> {
    const treeRes = await this.loadAndHydrate(treeId)
    if (!treeRes.ok) {
      return treeRes
    }
    return treeRes.value.getChildren(nodeId)
  }

  public async listLeaves(
    treeId: ConversationTreeId
  ): Promise<ConversationTreeResult<readonly ConversationNode[]>> {
    const treeRes = await this.loadAndHydrate(treeId)
    if (!treeRes.ok) {
      return treeRes
    }
    return {
      ok: true,
      value: treeRes.value.listLeaves()
    }
  }

  public async listBranches(
    treeId: ConversationTreeId
  ): Promise<ConversationTreeResult<readonly ConversationBranch[]>> {
    const treeRes = await this.loadAndHydrate(treeId)
    if (!treeRes.ok) {
      return treeRes
    }
    return {
      ok: true,
      value: treeRes.value.listBranches()
    }
  }

  public async listTrees(): Promise<ConversationTreeResult<readonly ConversationTreeDescriptor[]>> {
    return this.repository.list()
  }

  private async loadAndHydrate(
    treeId: ConversationTreeId
  ): Promise<ConversationTreeResult<ConversationTree>> {
    const loadResult = await this.repository.load(treeId)
    if (!loadResult.ok) {
      return loadResult
    }
    return ConversationTree.hydrate(loadResult.value)
  }
}
