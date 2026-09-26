// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionTreePanel } from '../../apps/desktop/src/renderer/src/features/session-tree/SessionTreePanel.js'
import { DemoConversationTreeUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { PortsProvider } from '../../apps/desktop/src/renderer/src/ports/ports.context.js'
import type { ConversationTreeSnapshot } from '../../apps/desktop/src/renderer/src/ports/conversation-tree-ui.port.js'

describe('SessionTreePanel Interactive Component', () => {
  const renderPanel = (
    customTreeAdapter?: DemoConversationTreeUiAdapter,
    highlightedNodeIds: readonly string[] = []
  ) => {
    const conversationTree = customTreeAdapter ?? new DemoConversationTreeUiAdapter()
    const ports = {
      conversationTree,
      providerSettings: new InMemoryProviderSettingsAdapter(),
      chatUi: new DemoChatUiAdapter()
    }

    return {
      ports,
      ...render(
        <PortsProvider ports={ports}>
          <SessionTreePanel highlightedNodeIds={highlightedNodeIds} />
        </PortsProvider>
      )
    }
  }

  it('renders tree canvas with default nodes and current node indicators', async () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: '会话树' })).toBeDefined()

    // Header displays current node status (default is #4 assistant)
    expect(await screen.findByText(/当前: #4 \(assistant\)/i)).toBeDefined()

    // Toolbar buttons rendered
    const setCurrentBtn = screen.getByRole('button', { name: '设为当前节点' })
    const addBtn = screen.getByRole('button', { name: '新增子节点或分支' })
    const deleteBtn = screen.getByRole('button', { name: '删除所选节点' })

    // Initially unselected -> all actions disabled
    expect((setCurrentBtn as HTMLButtonElement).disabled).toBe(true)
    expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('未选节点')).toBeDefined()

    // Default tree nodes are present in the DOM
    expect(screen.getByTestId('tree-node-node-root')).toBeDefined()
    expect(screen.getByTestId('tree-node-node-u1')).toBeDefined()
    expect(screen.getByTestId('tree-node-node-a1')).toBeDefined()
    expect(screen.getByTestId('tree-node-node-u2')).toBeDefined()
    expect(screen.getByTestId('tree-node-node-a2-b1')).toBeDefined()
    expect(screen.getByTestId('tree-node-node-a2-b2')).toBeDefined()

    // Content stays out of the topology until a node is hovered or focused.
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('tree-node-node-root'))
    expect(screen.getByRole('tooltip')).toBeDefined()
    expect(screen.getByText(/You are an intelligent AI conversational assistant/i)).toBeDefined()
    fireEvent.mouseLeave(screen.getByTestId('tree-node-node-root'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('applies presentation-only highlights through the public panel API', async () => {
    renderPanel(undefined, ['node-u1', 'node-a2-b2'])

    const highlighted = await screen.findByTestId('tree-node-node-u1')
    const notHighlighted = screen.getByTestId('tree-node-node-a1')

    expect(highlighted.getAttribute('data-highlighted')).toBe('true')
    expect(highlighted.classList.contains('is-highlighted')).toBe(true)
    expect(notHighlighted.getAttribute('data-highlighted')).toBe('false')
  })

  it('enables action buttons when selecting an eligible non-root node', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)

    const u1Node = screen.getByTestId('tree-node-node-u1')
    fireEvent.click(u1Node)

    expect(await screen.findByText('已选 1 项')).toBeDefined()

    const setCurrentBtn = screen.getByRole('button', { name: '设为当前节点' })
    const addBtn = screen.getByRole('button', { name: '新增子节点或分支' })
    const deleteBtn = screen.getByRole('button', { name: '删除所选节点' })

    // Can set as current, can add, can delete
    expect((setCurrentBtn as HTMLButtonElement).disabled).toBe(false)
    expect((addBtn as HTMLButtonElement).disabled).toBe(false)
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it('protects root node from deletion in toolbar', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)

    const rootNode = screen.getByTestId('tree-node-node-root')
    fireEvent.click(rootNode)

    expect(await screen.findByText('已选 1 项')).toBeDefined()

    const setCurrentBtn = screen.getByRole('button', { name: '设为当前节点' })
    const addBtn = screen.getByRole('button', { name: '新增子节点或分支' })
    const deleteBtn = screen.getByRole('button', { name: '删除所选节点' })

    // Root can be set as current and added to, but CANNOT be deleted
    expect((setCurrentBtn as HTMLButtonElement).disabled).toBe(false)
    expect((addBtn as HTMLButtonElement).disabled).toBe(false)
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables "Set as current" when the selected node is already the active current node', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)

    // node-a2-b1 is the current active node
    const currentActive = await screen.findByTestId('tree-node-node-a2-b1')
    fireEvent.click(currentActive)

    const setCurrentBtn = screen.getByRole('button', { name: '设为当前节点' })
    expect((setCurrentBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('switches current node via toolbar action', async () => {
    const user = userEvent.setup()
    const { ports } = renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)

    // Select node-u1 (#1)
    fireEvent.click(screen.getByTestId('tree-node-node-u1'))

    // Click "设为当前"
    const setCurrentBtn = screen.getByRole('button', { name: '设为当前节点' })
    await user.click(setCurrentBtn)

    // Header reflects updated current node
    expect(await screen.findByText(/当前: #1 \(user\)/i)).toBeDefined()

    const snap = (await ports.conversationTree.getSnapshot()).value!
    expect(snap.currentNodeId).toBe('node-u1')
  })

  it('opens add child node dialog and successfully adds child to parent', async () => {
    const user = userEvent.setup()
    const { ports } = renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)

    // Select node-a2-b2 (#5)
    fireEvent.click(screen.getByTestId('tree-node-node-a2-b2'))

    // Click "新增节点"
    await user.click(screen.getByRole('button', { name: '新增子节点或分支' }))

    // Dialog appears
    expect(await screen.findByRole('dialog', { name: '新增子节点' })).toBeDefined()
    expect(screen.getByText(/父节点: #5 \(assistant\)/i)).toBeDefined()

    // Type content
    const textarea = screen.getByPlaceholderText(/输入该节点的消息内容/i)
    await user.type(textarea, 'Brand new branch query from test!')

    // Submit form
    await user.click(screen.getByRole('button', { name: '确认添加' }))

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // New node exists in tree snapshot
    const snap = (await ports.conversationTree.getSnapshot()).value!
    const created = snap.nodes.find((n) => n.content === 'Brand new branch query from test!')
    expect(created).toBeDefined()
    expect(created?.parentId).toBe('node-a2-b2')
    expect(snap.currentNodeId).toBe(created?.id)
  })

  it('opens delete dialog and confirms deletion of selected node', async () => {
    const user = userEvent.setup()
    const { ports } = renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)

    // Select leaf node node-a2-b2
    fireEvent.click(screen.getByTestId('tree-node-node-a2-b2'))

    // Click "删除所选"
    await user.click(screen.getByRole('button', { name: '删除所选节点' }))

    // Dialog appears
    expect(await screen.findByRole('dialog', { name: '确认删除节点' })).toBeDefined()
    expect(screen.getByText(/已选择 1 个节点；本次将实际影响 1 个节点/i)).toBeDefined()
    expect((screen.getByLabelText('删除模式') as HTMLSelectElement).value).toBe('subtree')

    // Confirm deletion
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    // Dialog closes
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // Node is deleted
    const snap = (await ports.conversationTree.getSnapshot()).value!
    expect(snap.nodes.find((n) => n.id === 'node-a2-b2')).toBeUndefined()
  })

  it('renders error state and handles retry when tree snapshot fails validation', async () => {
    // Malformed tree with duplicate root
    const corruptSnapshot: ConversationTreeSnapshot = {
      treeId: 'tree-corrupt',
      revision: 1,
      rootId: 'root-1',
      currentNodeId: 'root-1',
      nodes: [
        {
          id: 'root-1',
          parentId: null,
          role: 'system',
          content: 'Root 1',
          sequence: 0,
          createdAt: '2026-09-25T00:00:00Z'
        },
        {
          id: 'root-2',
          parentId: null,
          role: 'system',
          content: 'Root 2',
          sequence: 1,
          createdAt: '2026-09-25T00:00:00Z'
        }
      ]
    }

    const adapter = new DemoConversationTreeUiAdapter(corruptSnapshot)
    renderPanel(adapter)

    expect(await screen.findByText('会话树结构异常')).toBeDefined()
    expect(screen.getByText(/Tree has 2 root nodes/i)).toBeDefined()
    expect(screen.getByRole('button', { name: '刷新重试' })).toBeDefined()
  })

  it('renders a distinct empty-tree state', async () => {
    const emptyTree: ConversationTreeSnapshot = {
      treeId: 'tree-empty',
      revision: 1,
      rootId: '',
      currentNodeId: '',
      nodes: []
    }

    renderPanel(new DemoConversationTreeUiAdapter(emptyTree))

    expect(await screen.findByText('暂无会话节点')).toBeDefined()
    expect(screen.queryByText('会话树结构异常')).toBeNull()
  })

  it('uses Escape to close a mutation dialog without mutating the tree', async () => {
    const user = userEvent.setup()
    const { ports } = renderPanel()

    await screen.findByText(/当前: #4 \(assistant\)/i)
    fireEvent.click(screen.getByTestId('tree-node-node-a2-b2'))
    await user.click(screen.getByRole('button', { name: '新增子节点或分支' }))
    expect(await screen.findByRole('dialog', { name: '新增子节点' })).toBeDefined()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const snapshot = await ports.conversationTree.getSnapshot()
    expect(snapshot.ok && snapshot.value.nodes).toHaveLength(6)
  })
})
