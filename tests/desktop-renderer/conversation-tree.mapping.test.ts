import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEMO_TREE_SNAPSHOT
} from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import {
  validateTreeSnapshot
} from '../../apps/desktop/src/renderer/src/features/session-tree/mapping/validate-tree-snapshot.js'
import {
  toFlowElements
} from '../../apps/desktop/src/renderer/src/features/session-tree/mapping/to-flow-elements.js'
import type { ConversationTreeSnapshot } from '../../apps/desktop/src/renderer/src/ports/conversation-tree-ui.port.js'

describe('Tree Snapshot Validation and Flow Element Mapping', () => {
  it('validates default branching demo tree successfully', () => {
    const result = validateTreeSnapshot(DEFAULT_DEMO_TREE_SNAPSHOT)
    expect(result.valid).toBe(true)
  })

  it('validates a single root node tree', () => {
    const singleNodeTree: ConversationTreeSnapshot = {
      treeId: 'tree-1',
      revision: 1,
      rootId: 'root',
      currentNodeId: 'root',
      nodes: [
        {
          id: 'root',
          parentId: null,
          role: 'system',
          content: 'Hello',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        }
      ]
    }
    expect(validateTreeSnapshot(singleNodeTree).valid).toBe(true)
  })

  it('rejects duplicate node IDs', () => {
    const duplicateTree: ConversationTreeSnapshot = {
      treeId: 'tree-dup',
      revision: 1,
      rootId: 'root',
      currentNodeId: 'root',
      nodes: [
        {
          id: 'root',
          parentId: null,
          role: 'system',
          content: 'Hello',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        },
        {
          id: 'root', // duplicate!
          parentId: 'root',
          role: 'user',
          content: 'Dup',
          sequence: 1,
          createdAt: '2026-09-25T00:01:00Z'
        }
      ]
    }
    const result = validateTreeSnapshot(duplicateTree)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.code).toBe('DUPLICATE_NODE_ID')
    }
  })

  it('rejects tree with multiple roots', () => {
    const multiRootTree: ConversationTreeSnapshot = {
      treeId: 'tree-multi-root',
      revision: 1,
      rootId: 'root1',
      currentNodeId: 'root1',
      nodes: [
        {
          id: 'root1',
          parentId: null,
          role: 'system',
          content: 'Root 1',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        },
        {
          id: 'root2',
          parentId: null, // multiple roots!
          role: 'system',
          content: 'Root 2',
          sequence: 1,
          createdAt: '2026-09-25T00:01:00Z'
        }
      ]
    }
    const result = validateTreeSnapshot(multiRootTree)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.code).toBe('MULTIPLE_ROOT_NODES')
    }
  })

  it('rejects tree when rootId does not match root node', () => {
    const mismatchTree: ConversationTreeSnapshot = {
      treeId: 'tree-mismatch',
      revision: 1,
      rootId: 'wrong-root-id',
      currentNodeId: 'actual-root',
      nodes: [
        {
          id: 'actual-root',
          parentId: null,
          role: 'system',
          content: 'Root',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        }
      ]
    }
    const result = validateTreeSnapshot(mismatchTree)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.code).toBe('ROOT_ID_MISMATCH')
    }
  })

  it('rejects missing or non-existent parentId', () => {
    const missingParentTree: ConversationTreeSnapshot = {
      treeId: 'tree-missing-parent',
      revision: 1,
      rootId: 'root',
      currentNodeId: 'root',
      nodes: [
        {
          id: 'root',
          parentId: null,
          role: 'system',
          content: 'Root',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        },
        {
          id: 'node-orphan',
          parentId: 'non-existent-parent',
          role: 'user',
          content: 'Orphan',
          sequence: 1,
          createdAt: '2026-09-25T00:01:00Z'
        }
      ]
    }
    const result = validateTreeSnapshot(missingParentTree)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.code).toBe('MISSING_PARENT')
    }
  })

  it('rejects self-referencing nodes', () => {
    const selfRefTree: ConversationTreeSnapshot = {
      treeId: 'tree-self-ref',
      revision: 1,
      rootId: 'root',
      currentNodeId: 'root',
      nodes: [
        {
          id: 'root',
          parentId: null,
          role: 'system',
          content: 'Root',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        },
        {
          id: 'node-self',
          parentId: 'node-self',
          role: 'user',
          content: 'Self',
          sequence: 1,
          createdAt: '2026-09-25T00:01:00Z'
        }
      ]
    }
    const result = validateTreeSnapshot(selfRefTree)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.code).toBe('SELF_REFERENCE')
    }
  })

  it('rejects cycles in node hierarchy', () => {
    const cycleTree: ConversationTreeSnapshot = {
      treeId: 'tree-cycle',
      revision: 1,
      rootId: 'root',
      currentNodeId: 'root',
      nodes: [
        {
          id: 'root',
          parentId: null,
          role: 'system',
          content: 'Root',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        },
        {
          id: 'node-a',
          parentId: 'node-b',
          role: 'user',
          content: 'A',
          sequence: 1,
          createdAt: '2026-09-25T00:01:00Z'
        },
        {
          id: 'node-b',
          parentId: 'node-a',
          role: 'assistant',
          content: 'B',
          sequence: 2,
          createdAt: '2026-09-25T00:02:00Z'
        }
      ]
    }
    const result = validateTreeSnapshot(cycleTree)
    expect(result.valid).toBe(false)
  })

  it('maps snapshot to nodes and edges and correctly identifies active path', () => {
    // Current node in default tree is node-a2-b1
    // Path should be: node-root -> node-u1 -> node-a1 -> node-u2 -> node-a2-b1
    // node-a2-b2 is a sibling branch and should NOT be on the active path!
    const selected = new Set(['node-u2'])
    const highlighted = new Set(['node-a2-b2'])
    const flowElements = toFlowElements(DEFAULT_DEMO_TREE_SNAPSHOT, selected, highlighted)

    expect(flowElements.nodes.length).toBe(6)
    expect(flowElements.edges.length).toBe(5)

    expect(flowElements.activePathNodeIds.has('node-root')).toBe(true)
    expect(flowElements.activePathNodeIds.has('node-u1')).toBe(true)
    expect(flowElements.activePathNodeIds.has('node-a1')).toBe(true)
    expect(flowElements.activePathNodeIds.has('node-u2')).toBe(true)
    expect(flowElements.activePathNodeIds.has('node-a2-b1')).toBe(true)
    expect(flowElements.activePathNodeIds.has('node-a2-b2')).toBe(false)

    // Node data attributes
    const currentNode = flowElements.nodes.find((n) => n.id === 'node-a2-b1')
    expect(currentNode?.data.isCurrent).toBe(true)
    expect(currentNode?.data.isPath).toBe(true)
    expect(currentNode?.data.isSelected).toBe(false)
    expect(currentNode?.draggable).toBe(true)

    const selectedNode = flowElements.nodes.find((n) => n.id === 'node-u2')
    expect(selectedNode?.data.isSelected).toBe(true)
    expect(selectedNode?.data.isPath).toBe(true)

    const branch2Node = flowElements.nodes.find((n) => n.id === 'node-a2-b2')
    expect(branch2Node?.data.isCurrent).toBe(false)
    expect(branch2Node?.data.isPath).toBe(false)
    expect(branch2Node?.data.isHighlighted).toBe(true)

    // Edges
    const activeEdge = flowElements.edges.find((e) => e.id === 'edge-node-u2-node-a2-b1')
    expect(activeEdge?.className).toBe('edge-active-path')

    const inactiveEdge = flowElements.edges.find((e) => e.id === 'edge-node-u2-node-a2-b2')
    expect(inactiveEdge?.className).toBe('edge-default')
  })
})
