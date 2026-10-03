import type { ConversationTreeSnapshot } from '../../ports/conversation-tree-ui.port.js'

/**
 * Visual-review fixture shaped like the DTO produced by Main's
 * conversation-turn projector. Each node represents one completed user /
 * assistant turn and uses the assistant message ID as its stable turn ID.
 */
export const REALISTIC_CONVERSATION_TREE_FIXTURE: ConversationTreeSnapshot = {
  treeId: 'tree-visual-review-2026-10-03',
  revision: 28,
  rootId: 'msg-assistant-0002',
  currentNodeId: 'msg-assistant-0028',
  nodes: [
    {
      id: 'msg-assistant-0002',
      parentId: null,
      question: '帮我规划一个支持多供应商模型的桌面 AI 对话应用。',
      answer:
        '可以先把系统拆为会话内核、模型适配器、Electron 隔离层和 Renderer。会话树只保存对话语义，模型调用通过独立运行时完成。',
      sequence: 0,
      createdAt: '2026-10-03T08:00:02.000Z',
      providerInfo: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }
    },
    {
      id: 'msg-assistant-0004',
      parentId: 'msg-assistant-0002',
      question: '会话树中的一个节点应该表示一条消息还是一轮问答？',
      answer:
        '内核保留一条消息一个节点；桌面端通过投影层把相邻的 User 与 Assistant 消息组合成一轮问答节点。',
      sequence: 1,
      createdAt: '2026-10-03T08:02:11.000Z',
      providerInfo: { provider: 'openai-compatible', modelId: 'gpt-5' }
    },
    {
      id: 'msg-assistant-0006',
      parentId: 'msg-assistant-0004',
      question: '默认上下文如何从树中构造？',
      answer:
        '从根节点沿唯一父链读取到当前节点，再把本次用户输入追加到末尾。分支之外的节点不会进入默认上下文。',
      sequence: 2,
      createdAt: '2026-10-03T08:04:36.000Z',
      providerInfo: { provider: 'gemini', modelId: 'gemini-2.5-pro' }
    },
    {
      id: 'msg-assistant-0008',
      parentId: 'msg-assistant-0006',
      question: '如果中途切换模型，会破坏会话树吗？',
      answer:
        '不会。模型和协议属于每轮生成元数据，树的父子关系只表达对话继承，因此不同分支可以使用不同供应商。',
      sequence: 3,
      createdAt: '2026-10-03T08:06:18.000Z',
      providerInfo: { provider: 'anthropic', modelId: 'claude-opus-4-1' }
    },
    {
      id: 'msg-assistant-0010',
      parentId: 'msg-assistant-0008',
      question: '给出流式输出与会话写入的时序。',
      answer:
        '请求开始后先产生 started，再连续发送 delta；只有完整响应成功写入树后才发送 completed 和新的会话快照。',
      sequence: 4,
      createdAt: '2026-10-03T08:08:59.000Z',
      providerInfo: { provider: 'openai-compatible', modelId: 'gpt-5' }
    },
    {
      id: 'msg-assistant-0012',
      parentId: 'msg-assistant-0010',
      question: '取消请求时怎样避免留下半成品节点？',
      answer:
        '运行时回滚本轮新建的 User 节点并恢复请求前游标；Renderer 只展示完成的问答轮次。',
      sequence: 5,
      createdAt: '2026-10-03T08:11:24.000Z',
      providerInfo: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }
    },
    {
      id: 'msg-assistant-0014',
      parentId: 'msg-assistant-0004',
      question: '另一种方案：能不能让前端直接保存问答节点？',
      answer:
        '可以用于纯原型，但会让 Renderer 成为事实来源，并削弱内核的树不变量与失败补偿能力，不适合作为正式架构。',
      sequence: 6,
      createdAt: '2026-10-03T08:13:05.000Z',
      providerInfo: { provider: 'gemini', modelId: 'gemini-2.5-flash' }
    },
    {
      id: 'msg-assistant-0016',
      parentId: 'msg-assistant-0014',
      question: '这个原型方案适合保留到什么程度？',
      answer:
        '仅保留为开发环境 fixture 和视觉回归入口，正式 Electron 模式始终从 Main Process 获取快照。',
      sequence: 7,
      createdAt: '2026-10-03T08:15:42.000Z',
      providerInfo: { provider: 'openai-compatible', modelId: 'gpt-4.1-mini' }
    },
    {
      id: 'msg-assistant-0018',
      parentId: 'msg-assistant-0006',
      question: '我还需要自由选择若干历史节点作为上下文。',
      answer:
        '自由选择模式按节点 sequence 稳定排序，并由 Main 将每轮展开为 User 与 Assistant 消息，最后追加新问题。',
      sequence: 8,
      createdAt: '2026-10-03T08:18:31.000Z',
      providerInfo: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }
    },
    {
      id: 'msg-assistant-0020',
      parentId: 'msg-assistant-0018',
      question: '自由选择能否跨越不同分支？',
      answer:
        '可以。它表示显式上下文集合，不要求形成连续路径，但所有 ID 必须属于同一棵树且对应完整轮次。',
      sequence: 9,
      createdAt: '2026-10-03T08:20:20.000Z',
      providerInfo: { provider: 'gemini', modelId: 'gemini-2.5-pro' }
    },
    {
      id: 'msg-assistant-0022',
      parentId: 'msg-assistant-0010',
      question: '会话树前端怎样表达当前路径、选中和继承？',
      answer:
        '三种状态分别显示：当前节点是唯一游标，选择是临时操作状态，继承高亮表示下一次请求会携带的历史轮次。',
      sequence: 10,
      createdAt: '2026-10-03T08:23:08.000Z',
      providerInfo: { provider: 'openai-compatible', modelId: 'gpt-5' }
    },
    {
      id: 'msg-assistant-0024',
      parentId: 'msg-assistant-0022',
      question: '节点很多时，画布交互应该怎样处理？',
      answer:
        '节点位置由层级布局固定，用户只能平移和缩放视角；悬停显示问答内容，工具栏提供适应视图和定位当前节点。',
      sequence: 11,
      createdAt: '2026-10-03T08:25:47.000Z',
      providerInfo: { provider: 'anthropic', modelId: 'claude-haiku-4-5' }
    },
    {
      id: 'msg-assistant-0026',
      parentId: 'msg-assistant-0024',
      question: '怎样突出刚生成的节点？',
      answer:
        '通过独立的 highlightedNodeIds 展示短暂强调效果，不修改树快照，也不把视觉状态写回内核。',
      sequence: 12,
      createdAt: '2026-10-03T08:28:12.000Z',
      providerInfo: { provider: 'gemini', modelId: 'gemini-2.5-flash' }
    },
    {
      id: 'msg-assistant-0028',
      parentId: 'msg-assistant-0026',
      question: '现在使用这棵测试树检查 React Flow 的显示密度。',
      answer:
        '已生成包含主干、三处分支和混合模型元数据的测试快照，可检查自动布局、曲线、路径高亮、缩放和平移。',
      sequence: 13,
      createdAt: '2026-10-03T08:30:44.000Z',
      providerInfo: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }
    }
  ]
}
