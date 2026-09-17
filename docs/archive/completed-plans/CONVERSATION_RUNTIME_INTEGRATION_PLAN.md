# 会话树与流式模型内核集成实施计划

> 文档性质：架构、接口、实施步骤与验收要求。本文只定义任务，不包含具体实现代码。
> 当前阶段：把现有 `ChatKernel` 流式请求能力与 `chat-conversation-tree` 会话树连接起来，并提供可交互的 CLI 调试入口。
> 核心原则：会话树和模型协议继续保持独立，由新的 application/runtime 协调层完成组合。

## 1. 本阶段目标

完成以下能力：

1. 提供一个高层 `sendMessage()` 函数：根据指定或当前节点取得 root-to-node 上下文，追加用户消息，调用模型并转发流式事件。
2. 模型正常完成后，把完整 assistant 内容作为用户节点的子节点写入会话树。
3. 提供显式切换当前节点的接口；后续发送从该节点创建新分支。
4. 扩展测试 CLI，使其可以在同一进程中连续对话、切换节点、查看路径和分支。
5. 为 CLI 提供简单、稳定、可读的 ASCII 树形拓扑展示。
6. 保持不同轮次可使用不同 provider/model；树中只记录 `providerId` 和 `modelId`，绝不保存 API Key 或请求配置。
7. 完成单元测试、集成测试、CLI 测试和全仓回归。

本阶段不是 Electron UI 集成阶段，不增加 Renderer store、React hook、Preload API 或 IPC channel。

## 2. 已有能力与约束

### 2.1 现有模型请求链路

当前 `ChatKernel`：

- 接收 `StartChatCommand`；
- 要求 messages 最后一条为非空 user 消息；
- 通过 `ChatEventSink` 依次发出 started、delta 和一个 terminal event；
- terminal event 为 completed、failed 或 cancelled；
- `start()` 只表示请求被接受，最终结果仍通过事件返回；
- `ChatKernel` 实例绑定一个 `ChatModelPort`，若下一轮切换 provider/model，应创建新的模型 Adapter 和 Kernel/Executor。

### 2.2 现有会话树

当前 `ConversationTreeService` 已提供：

- `createTree()`；
- `appendNode()` / `forkFromNode()`；
- `getTree()` / `getNode()` / `getPathToNode()`；
- `getChildren()` / `listLeaves()` / `listBranches()`；
- optimistic version checking。

节点只保存对话事实：role、content、parent、sequence、createdAt，以及可选的 `generatedBy.providerId/modelId`。

### 2.3 必须维持的依赖方向

```text
apps/test-cli
  ├── chat-model-adapters
  ├── chat-core
  └── chat-conversation-runtime
          ├── chat-contracts
          └── chat-conversation-tree

chat-conversation-tree ──X──> chat-core / adapters / Electron / UI
chat-core              ──X──> chat-conversation-tree
```

只有新的协调层知道“模型流完成后应写树”。会话树本身不得新增 fetch、AbortController、ProviderConfig、ChatKernel 或流状态依赖。

## 3. 建议新增 package

新增：

```text
packages/conversation-runtime/
```

package name：

```text
chat-conversation-runtime
```

它属于 application orchestration layer，不属于树领域层，也不属于模型 Adapter 层。

建议依赖：

```json
{
  "dependencies": {
    "chat-contracts": "workspace:*",
    "chat-conversation-tree": "workspace:*"
  }
}
```

协调层通过 port 接收可执行流式请求的对象，因此不必依赖具体 Adapter，也可以不直接依赖 `chat-core`。CLI 在 composition root 中创建 Adapter、ChatKernel，再把它包装成 runtime port。

## 4. 总体请求流程

```text
CLI / future UI
  │
  │ sendMessage(treeId, prompt, selectedNodeId?, modelRuntime)
  ▼
ConversationRuntimeService
  │
  ├─ 1. 加载 tree；新 tree 时用 prompt 创建 user root
  ├─ 2. 已有 tree 时，在 selected/current 节点下追加 user 子节点
  ├─ 3. 获取 root → 新 user 节点的唯一路径
  ├─ 4. 路径映射为 ChatKernel messages
  ├─ 5. 调用 StreamingChatExecutor.start()
  ├─ 6. started/delta 实时转发，并只在内存中累积 delta
  ├─ 7. completed 后把完整 assistant 内容追加到 user 子节点
  └─ 8. assistant 保存成功后，将 currentNodeId 切到 assistant 节点
```

### 4.1 首轮消息

当 `treeId` 不存在时：

- `prompt` 直接成为这棵树的 user 根节点；
- 当前节点设置为该 user root；
- 上下文就是 `[root user message]`；
- 模型完成后 assistant 成为 root 的 child；
- 当前节点切换到 assistant。

不得为了“空树”制造空 content 的占位根节点。

### 4.2 后续消息

当 `treeId` 已存在时：

- 确定 base node：优先使用 command 中显式传入的 `selectedNodeId`，否则使用运行时 cursor；
- 在 base node 下追加新的 user 节点；
- 上下文采用 root-to-new-user 的完整路径；
- sibling branch 不得进入 messages；
- 模型完成后 assistant 挂载到这个新 user 节点下。

### 4.3 分支语义

假设当前树为：

```text
U1
└─ A1
   └─ U2
      └─ A2  ← current
```

执行 `selectNode(A1)`，再发送 `U3`，结果必须是：

```text
U1
└─ A1
   ├─ U2
   │  └─ A2
   └─ U3
      └─ A3  ← current
```

请求 A3 时的上下文只能是 `U1 → A1 → U3`，不能包含 U2 或 A2。

## 5. 当前节点游标设计

“当前节点”不是对话事实，不得加入 `ConversationNode` 或 snapshot。

新增独立游标：

```ts
export interface ConversationCursor {
  readonly treeId: ConversationTreeId
  readonly currentNodeId: ConversationNodeId
}
```

第一阶段可以由 `InMemoryConversationCursorStore` 管理：

```ts
export interface ConversationCursorStore {
  get(treeId: ConversationTreeId): ConversationNodeId | undefined
  set(treeId: ConversationTreeId, nodeId: ConversationNodeId): void
  delete(treeId: ConversationTreeId): void
}
```

选择接口：

```ts
selectNode(command: SelectConversationNodeCommand): Promise<ConversationRuntimeResult<ConversationCursor>>

export interface SelectConversationNodeCommand {
  readonly treeId: ConversationTreeId
  readonly nodeId: ConversationNodeId
}
```

规则：

- tree 不存在：`TREE_NOT_FOUND`；
- node 不属于该 tree 或不存在：`NODE_NOT_FOUND`；
- 有进行中的 turn 时：返回 `TURN_IN_PROGRESS`，避免完成回调覆盖用户刚切换的游标；
- 查询和切换 cursor 不修改 tree version；
- 打开已有 tree 且尚无 cursor 时，默认选中 sequence 最大的 leaf；调用方也可显式 select。

## 6. 模型执行 Port

新增最小化 port，隔离协调层与具体模型/Adapter：

```ts
export interface StreamingChatExecutor {
  start(command: StartChatCommand, sink: StreamingChatEventSink): Promise<StartChatResult>
  cancel(command: CancelChatCommand): Promise<CancelChatResult>
}

export interface StreamingChatEventSink {
  emit(event: ChatEvent): void
}

export interface ModelExecutionDescriptor {
  readonly providerId: string
  readonly modelId: string
  readonly executor: StreamingChatExecutor
}
```

`StreamingChatEventSink` 只使用 `chat-contracts` 中的 `ChatEvent`；现有 `ChatKernel` 在 TypeScript 结构类型上直接满足 `StreamingChatExecutor`，无需协调层 import `chat-core`。

CLI 的 composition root 执行：

```text
ProviderConfig
  → createModelAdapter(config)
  → new ChatKernel(adapter)
  → { providerId, modelId, executor: kernel }
```

重要限制：

- `ModelExecutionDescriptor` 可以逐 turn 更换；
- `providerId/modelId` 用于成功后写入 `generatedBy`；
- API Key、Base URL、Header 和 ProviderConfig 不得进入树节点或 snapshot；
- 协调层不得根据 openai/anthropic/gemini 写 switch；协议选择仍属于 Adapter factory。

## 7. 核心公开接口

### 7.1 高层发送函数

```ts
export class ConversationRuntimeService {
  constructor(
    treeService: ConversationTreeService,
    cursorStore: ConversationCursorStore,
    idGenerator: ConversationRuntimeIdGenerator
  )

  sendMessage(
    command: SendConversationMessageCommand,
    sink: ConversationTurnEventSink
  ): Promise<ConversationRuntimeResult<CompletedConversationTurn>>

  selectNode(
    command: SelectConversationNodeCommand
  ): Promise<ConversationRuntimeResult<ConversationCursor>>

  getCurrentNode(
    treeId: ConversationTreeId
  ): Promise<ConversationRuntimeResult<ConversationNode>>

  cancelTurn(
    command: CancelConversationTurnCommand
  ): Promise<ConversationRuntimeResult<void>>
}
```

发送 command：

```ts
export interface SendConversationMessageCommand {
  readonly treeId: ConversationTreeId
  readonly prompt: string
  readonly selectedNodeId?: ConversationNodeId
  readonly model: ModelExecutionDescriptor
}
```

取消 command 以 tree 为作用域；runtime 从 active-turn registry 取得对应 request ID 和 executor：

```ts
export interface CancelConversationTurnCommand {
  readonly treeId: ConversationTreeId
}
```

ID 必须通过注入的 generator 生成，方便测试：

```ts
export interface ConversationRuntimeIdGenerator {
  nextRequestId(): string
  nextUserNodeId(): ConversationNodeId
  nextAssistantNodeId(): ConversationNodeId
}
```

成功结果：

```ts
export interface CompletedConversationTurn {
  readonly treeId: ConversationTreeId
  readonly requestId: string
  readonly baseNodeId: ConversationNodeId | null
  readonly userNodeId: ConversationNodeId
  readonly assistantNodeId: ConversationNodeId
  readonly currentNodeId: ConversationNodeId
  readonly finishReason: 'stop' | 'length' | 'unknown'
  readonly treeVersion: number
}
```

`baseNodeId` 在新树首轮为 null；已有树时是发送前选中的节点。

### 7.2 Runtime Result 与错误码

```ts
export type ConversationRuntimeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConversationRuntimeError }
```

至少提供：

```ts
export type ConversationRuntimeErrorCode =
  | 'TREE_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'TURN_IN_PROGRESS'
  | 'INVALID_PROMPT'
  | 'CONTEXT_LIMIT_EXCEEDED'
  | 'MODEL_REQUEST_REJECTED'
  | 'MODEL_REQUEST_FAILED'
  | 'MODEL_REQUEST_CANCELLED'
  | 'EMPTY_MODEL_RESPONSE'
  | 'TREE_VERSION_CONFLICT'
  | 'ASSISTANT_PERSIST_FAILED'
  | 'INTERNAL_ERROR'
```

不得要求调用方解析 error message。底层 `ConversationTreeError` 和 `ChatPublicError` 应保留在结构化 details/cause 中，禁止泄露 API Key 或原始敏感响应。

## 8. Runtime 流式事件

不要直接把底层 `chat.stream.completed` 原样转发给上层，因为底层 completed 到达时 assistant 尚未写树。

定义协调层事件：

```ts
export type ConversationTurnEvent =
  | {
      type: 'conversation.turn.started'
      treeId: ConversationTreeId
      requestId: string
      userNodeId: ConversationNodeId
    }
  | {
      type: 'conversation.turn.delta'
      treeId: ConversationTreeId
      requestId: string
      userNodeId: ConversationNodeId
      assistantNodeId: ConversationNodeId
      sequence: number
      delta: string
    }
  | {
      type: 'conversation.turn.completed'
      treeId: ConversationTreeId
      requestId: string
      userNodeId: ConversationNodeId
      assistantNodeId: ConversationNodeId
      currentNodeId: ConversationNodeId
      finishReason: 'stop' | 'length' | 'unknown'
      treeVersion: number
    }
  | {
      type: 'conversation.turn.failed'
      treeId: ConversationTreeId
      requestId: string
      userNodeId: ConversationNodeId
      error: ConversationRuntimeError
    }
  | {
      type: 'conversation.turn.cancelled'
      treeId: ConversationTreeId
      requestId: string
      userNodeId: ConversationNodeId
    }
```

```ts
export interface ConversationTurnEventSink {
  emit(event: ConversationTurnEvent): void
}
```

事件时序保证：

```text
started → delta* → exactly one of completed / failed / cancelled
```

`conversation.turn.completed` 只能在 assistant 节点成功持久化、cursor 成功切换之后发出。CLI 收到 completed 时立即查询树，必须能看到新 assistant 节点。

## 9. 上下文映射规则

协调层取得 `getPathToNode(treeId, userNodeId)`，按 root-first 顺序映射：

```ts
{
  role: node.role,
  content: node.content
}
```

规则：

- 不发送 node ID、tree ID、sequence、createdAt 或 generatedBy；
- 不发送 sibling、cousin 或其他 leaf 的内容；
- 路径最后一个节点必须是本轮新 user 节点；
- 路径长度和字符数必须服从现有 `ChatKernel` 限制；
- 不在协调层擅自裁剪历史。超限时返回 `CONTEXT_LIMIT_EXCEEDED`，后续上下文压缩另行设计；
- 同一条路径允许出现来自不同 provider/model 的旧 assistant 节点；历史消息只按 role/content 发送。

建议把映射拆成纯函数，便于测试：

```ts
buildChatContext(path: readonly ConversationNode[]): ConversationRuntimeResult<readonly ChatMessageInput[]>
```

## 10. 写树与失败语义

### 10.1 何时写 user

- 新 tree：调用 `createTree()`，prompt 为 user root；
- 已有 tree：在 base node 下调用 `appendNode()`，prompt 为新的 user child；
- user 节点写成功后再启动模型请求；
- user 节点写成功后，cursor 立即指向该 user 节点。

### 10.2 何时写 assistant

仅在模型发出 completed 后执行：

```ts
treeService.appendNode({
  treeId,
  expectedVersion,
  parentId: userNodeId,
  node: {
    id: assistantNodeId,
    role: 'assistant',
    content: accumulatedText,
    generatedBy: { providerId, modelId }
  }
})
```

完成后 cursor 指向 assistant。

### 10.3 delta

- delta 立即转发给 sink；
- delta 只在当前 turn 的内存 buffer 中累积；
- 禁止每个 delta 修改树；
- 禁止创建 `isStreaming` 节点字段；
- 进程异常退出时最多丢失当前未完成 assistant，不会产生半截 assistant 历史。

### 10.4 failed / cancelled

- 保留已提交的 user 节点；
- 不创建 assistant 节点；
- cursor 保持在该 user 节点，允许重试或从别处分支；
- 丢弃内存中的 partial assistant buffer；
- failed/cancelled 不写入 ConversationNode。

### 10.5 空响应

如果 completed 时 accumulated text 去除空白后为空：

- 不创建 assistant；
- 返回 `EMPTY_MODEL_RESPONSE`；
- cursor 保持 user；
- 发出 failed，而不是 completed。

### 10.6 并发和 version conflict

- 每个 tree 同一时间最多一个 active turn；不同 tree 可以并行；
- active turn 信息保存在 runtime 内存，不进入 tree；
- 发起时记录 user 写入后的 tree version；
- assistant 持久化使用 optimistic version；
- 出现 `VERSION_CONFLICT` 时不得静默覆盖；返回 `TREE_VERSION_CONFLICT`，不发 completed；
- 第一阶段不自动重试持久化，避免把 assistant 挂到调用方未预期的新状态；后续如要重试必须先重新验证 parent 和 assistant ID。

## 11. CLI 调试设计

### 11.1 保留原有一次性模式

原命令继续可用：

```bash
pnpm cli:test --prompt "hello" --no-color
```

它可以内部改用 runtime 完成“一棵新树 + 一轮 user/assistant”，但输出兼容现有纯流式文本。

建议新增专用交互脚本：

```json
{
  "cli:session": "pnpm --filter chat-test-cli run start -- --interactive"
}
```

或等价命名 `cli:tree`。实现时选择一个并在 README 固定下来，不同时维护两个别名。

### 11.2 新增 CLI 参数

```text
--interactive            进入多轮 REPL 调试模式
--tree-id <id>           指定本次内存会话树 ID；默认自动生成
--show-tree              每轮 completed 后打印拓扑
--tree-content-width <n> 每个节点预览的最大字符数，默认 40
```

已有 provider/base-url/api-key/model-id/timeout/format/no-color 参数继续复用。

第一阶段仓储仍为内存实现，因此 CLI 进程退出后树不会保留。帮助文本必须明确说明这一点。

### 11.3 REPL 命令

```text
<普通文本>             从 current 节点发送新 user 消息
/send <text>           与普通文本等价
/tree                  打印整棵树
/current               打印当前 treeId、nodeId、role 和 content 预览
/select <node-id>      切换当前节点
/path                  打印 root → current 路径
/leaves                列出可选择的 leaf IDs
/branches              列出每条 root-to-leaf node ID 路径
/cancel                取消当前流式请求
/help                  显示 REPL 命令
/quit                  正常退出
```

行为要求：

- `/select` 成功后不修改树；下一条普通文本从选中节点创建 user child；
- 不存在的 node ID 给出错误并保持原 cursor；
- 请求过程中普通输入和 `/select` 返回 busy 提示；`/cancel` 可用；
- REPL 不能在发送后阻塞整个 readline 循环；active turn 在后台等待 terminal，使用户仍能输入 `/cancel`；
- 空行忽略；
- CLI 错误输出不得打印 API Key；
- SIGINT 在 active turn 时先 cancel；空闲时退出。

### 11.4 Provider/model 切换

协调器必须支持每轮传入不同 `ModelExecutionDescriptor`。CLI 首期可以使用启动参数固定本进程默认模型；如果实现 Agent 增加 `/model`，只能作为附加功能，不得因此把 ProviderConfig 保存到树中，也不得延误核心验收。

## 12. CLI 树形可视化

新增纯函数：

```ts
renderConversationTree(
  snapshot: ConversationTreeSnapshot,
  currentNodeId: ConversationNodeId,
  options?: { contentWidth?: number; color?: boolean }
): string
```

示例：

```text
tree demo-tree  version=7  nodes=6
└─ [U] u-001  "解释一下事件循环"
   ├─ [A] a-001  openai-compatible/gpt-4.1  "事件循环负责……"
   │  └─ [U] u-002  "换一个例子"
   │     └─ [A]* a-002  anthropic/claude-sonnet  "可以把它想成……"
   └─ [A] a-003  gemini/gemini-pro  "从调度角度看……"

* = current
```

渲染规则：

- 使用 `├─`、`└─`、`│` 表示结构；
- `[S]`、`[U]`、`[A]` 表示 system/user/assistant；
- 当前节点在角色后加 `*`；
- assistant 有 generatedBy 时显示 `providerId/modelId`；
- content 合并换行、压缩连续空白并按配置截断；
- sibling 以 sequence 升序排列，输出稳定；
- 不显示 API 配置、请求 ID、错误堆栈；
- `--no-color` 时完全不输出 ANSI；结构字符本身不依赖颜色；
- 空树不是有效状态，收到损坏 snapshot 应返回可读错误而不是崩溃。

### 12.1 text 与 jsonl

- `format=text`：`/tree` 和 `--show-tree` 输出上述 ASCII；
- `format=jsonl`：不得混入 ASCII。输出一条结构化记录，例如：

```json
{"type":"cli.tree.snapshot","treeId":"demo-tree","currentNodeId":"a-002","snapshot":{}}
```

测试只验证 JSON 可解析和敏感字段不存在，不硬编码时间。

## 13. 建议文件结构

```text
packages/conversation-runtime/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── conversation-runtime.service.ts
    ├── context-builder.ts
    ├── active-turn.registry.ts
    ├── domain/
    │   ├── conversation-runtime.types.ts
    │   ├── conversation-runtime.events.ts
    │   └── conversation-runtime.errors.ts
    └── ports/
        ├── streaming-chat-executor.port.ts
        ├── conversation-cursor-store.port.ts
        └── runtime-id-generator.port.ts

apps/test-cli/src/
├── cli-args.ts                    # 扩展 interactive/tree 参数
├── cli-config.ts                  # 扩展配置解析
├── cli-runner.ts                  # 保留一次性入口
├── session-cli-runner.ts          # REPL 生命周期
├── session-command.parser.ts      # /select、/tree 等命令
├── conversation-tree.renderer.ts # 纯 ASCII renderer
├── cli-output.ts                  # runtime event 和 tree 输出
└── main.ts

tests/conversation-runtime/
├── context-builder.test.ts
├── conversation-runtime.success.test.ts
├── conversation-runtime.failure.test.ts
├── conversation-runtime.branch.test.ts
├── conversation-runtime.concurrent.test.ts
└── conversation-runtime.mixed-provider.test.ts

tests/cli/
├── session-command.parser.test.ts
├── conversation-tree.renderer.test.ts
├── session-cli-runner.test.ts
└── conversation-runtime-cli.integration.test.ts
```

允许 Agent 根据职责稍微拆分文件，但不得把协调逻辑塞进 `ChatKernel`、`ConversationTree` 或 `main.ts`。

## 14. 分阶段实施步骤

### Phase A：Runtime 类型与 ports

1. 创建 `chat-conversation-runtime` package。
2. 定义 result、error、event、command 和完成结果。
3. 定义 executor、cursor store、ID generator ports。
4. 实现 in-memory cursor store 和 active-turn registry。
5. 增加 package export、tsconfig 和 workspace build/typecheck。

完成标准：package 可独立 typecheck，不依赖 adapters/Electron/UI。

### Phase B：上下文与成功链路

1. 实现 `buildChatContext()`。
2. 实现新 tree 首轮 user root。
3. 实现已有 tree 在 current/selected node 下追加 user。
4. 启动 executor，转发 delta 并累积 content。
5. completed 后追加 assistant，记录 generatedBy。
6. assistant 写成功后更新 cursor，再发 runtime completed。

完成标准：线性多轮和从历史节点分支均通过 fake executor 测试。

### Phase C：失败、取消与并发

1. 实现 rejected、failed、cancelled、empty response 映射。
2. 实现 `cancelTurn()`。
3. 每 tree 增加 active turn guard。
4. 实现 version conflict 错误，不静默覆盖。
5. 确保所有 terminal 分支释放 active-turn registry。

完成标准：任何失败都不产生半截 assistant；下一轮仍可继续。

### Phase D：CLI 组合与 REPL

1. CLI composition root 创建 repository、tree service、runtime service。
2. 复用 provider config 创建 ChatKernel executor。
3. 保留 one-shot；增加 interactive runner。
4. 实现 `/send`、`/select`、`/tree`、`/current`、`/path`、`/leaves`、`/branches`、`/cancel`、`/quit`。
5. 更新 help、README 和 CLI 测试说明。

完成标准：不访问真实网络也能通过 fake executor 跑完整 CLI 流程。

### Phase E：拓扑 renderer 与回归

1. 实现纯 ASCII renderer。
2. 覆盖分支、current marker、截断、换行、稳定排序、no-color、jsonl。
3. 更新 boundary lint。
4. 跑专项和全仓回归。

完成标准：所有验收命令通过。

## 15. 测试矩阵

### 15.1 上下文

- 新 tree 首轮 prompt 成为 user root。
- 线性路径正确映射 role/content。
- 从历史节点分支时不包含 sibling branch。
- system/user/assistant role 保持不变。
- path 最后一条必定是新 user。
- 上下文超限时模型 executor 不被调用。

### 15.2 成功流

- started → 多个 delta → completed。
- delta 原顺序向上转发，完整内容正确拼接。
- completed 之前树中不存在 assistant 节点。
- assistant 持久化后才发 runtime completed。
- assistant parentId 等于本轮 userNodeId。
- assistant generatedBy 与当前 turn provider/model 一致。
- 完成后 cursor 指向 assistant。
- tree version：user 写入 +1，assistant 写入再 +1。

### 15.3 分支与选择

- `selectNode()` 选择 root、内部节点和 leaf。
- 选择不存在节点失败且 cursor 不变。
- 选择其他 tree 的 node 失败。
- 从历史节点发送形成新 branch。
- 新分支上下文不包含旧 sibling。
- current 只影响对应 tree，不同 tree cursor 隔离。
- 查询/切换 cursor 不改变 tree version。

### 15.4 失败与取消

- executor start rejected。
- stream failed before delta。
- stream failed after partial delta。
- cancelled before delta / after partial delta。
- completed 但响应为空。
- 上述情况都保留 user、不创建 assistant、cursor 停在 user。
- partial delta 不进入 snapshot。
- terminal 后 active-turn lock 被释放。

### 15.5 并发与版本

- 同一 tree 第二个请求返回 `TURN_IN_PROGRESS`。
- active turn 中 select 返回 `TURN_IN_PROGRESS`。
- 不同 tree 可以并行。
- assistant 持久化前发生外部 tree mutation 时返回 `TREE_VERSION_CONFLICT`。
- 冲突后不覆盖外部 mutation，不发 completed。
- 重复或迟到 terminal event 不产生重复 assistant。

### 15.6 混合模型

- 同一树连续两轮使用不同 provider/model。
- 两个 assistant 节点分别记录正确 generatedBy。
- 历史上下文只含 role/content，不携带 provider 配置。
- API key、base URL 不出现在 snapshot、runtime event、CLI tree 输出或错误文本中。

### 15.7 CLI 与拓扑

- 参数解析和 help。
- 普通文本与 `/send` 等价。
- `/select` 后下一轮生成新 branch。
- `/tree` 对线性树和多分支树输出正确连接线。
- current marker 唯一且正确。
- 内容换行压缩与宽度截断。
- sibling 顺序稳定。
- `--show-tree` 只在 terminal 后输出。
- text/no-color 不含 ANSI。
- jsonl 每行可独立 JSON.parse，且不混 ASCII。
- SIGINT、timeout 和 `/cancel` 都能结束请求并释放资源。

## 16. Fake 与集成测试要求

不得使用真实 API Key 或公网模型完成 CI。

建议提供 `ScriptedStreamingChatExecutor` 测试替身：

```ts
[
  { type: 'started' },
  { type: 'delta', text: 'hel' },
  { type: 'delta', text: 'lo' },
  { type: 'completed', finishReason: 'stop' }
]
```

还需要可控的 deferred executor，用于断言：

- completed 到来前没有 assistant；
- active turn 时 select/send 被拒绝；
- 外部 mutation 制造 version conflict；
- cancel 后只产生一个 terminal。

至少增加一组使用真实 `ChatKernel + fake ChatModelPort` 的集成测试，验证协调层 port 与现有内核的事件契约确实兼容。

## 17. Boundary lint 要求

更新 `scripts/lint-boundaries.mjs`：

- `conversation-tree` 继续禁止 import runtime/core/adapters/network/UI；
- `chat-core` 继续禁止 import conversation-tree/runtime；
- `conversation-runtime` 禁止 import Electron、React、Zustand、Node terminal API；
- `conversation-runtime` 禁止 import具体 OpenAI/Anthropic/Gemini Adapter 类；
- `apps/test-cli` 可以 import runtime，并负责具体 Adapter composition；
- desktop/debug-renderer 本阶段不得 import runtime。

## 18. 可修改文件范围

允许：

```text
packages/conversation-runtime/**
apps/test-cli/**
tests/conversation-runtime/**
tests/cli/**
scripts/lint-boundaries.mjs
vitest.config.ts
package.json
pnpm-lock.yaml
README.md
docs/plans/CONVERSATION_RUNTIME_INTEGRATION_PLAN.md
```

只有在测试证明现有公开接口无法安全完成集成时，才允许最小修改：

```text
packages/chat-core/**
packages/chat-contracts/**
packages/conversation-tree/**
```

若需要修改上述三个已有 package，Agent 必须在交付说明中列出原因、接口变化和回归范围。禁止修改 Electron/Renderer。

## 19. 建议根脚本

```json
{
  "typecheck:conversation-runtime": "pnpm --filter chat-conversation-runtime run typecheck",
  "test:conversation-runtime": "vitest run tests/conversation-runtime tests/cli",
  "build:conversation-runtime": "pnpm --filter chat-conversation-runtime run build",
  "cli:session": "pnpm --filter chat-test-cli run start -- --interactive"
}
```

## 20. 验收命令

```bash
pnpm typecheck:conversation-runtime
pnpm test:conversation-runtime
pnpm build:conversation-runtime
pnpm lint:boundaries
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

手工 CLI 验收：

```bash
pnpm build
pnpm cli:session --provider openai-compatible --base-url <url> --model-id <model> --show-tree --no-color
```

交互步骤：

```text
1. 输入第一条消息，确认流式输出并自动出现 U1 → A1。
2. 输入第二条消息，确认形成 U1 → A1 → U2 → A2。
3. 执行 /tree，记录 A1 的 node ID。
4. 执行 /select <A1-ID>。
5. 输入第三条消息，确认从 A1 产生第二个 user branch。
6. 执行 /path，确认只显示新分支路径。
7. 执行 /tree，确认 current marker 位于新 assistant。
8. 请求中执行 /cancel，确认 partial assistant 没有写入树。
```

手工测试禁止把真实 API Key 写进 shell history；优先使用环境变量。

## 21. 最终验收标准

- 一个高层函数完成“选择上下文 → 发起流式请求 → 完成后写 assistant”。
- 上下文严格来自选中节点所在 root-to-node path。
- completed 后 assistant 自动成为本轮 user 的 child。
- failed/cancelled/empty response 不写 assistant partial。
- current node 可以查询和切换，且不污染 ConversationNode/snapshot。
- 从历史节点发送能形成真实分支。
- 同一树可记录不同 provider/model 的 assistant。
- CLI 可以多轮发送、选择节点、取消请求和查看树。
- ASCII 拓扑结构、current marker 和稳定顺序清晰可读。
- API Key/Base URL 不进入树、事件、拓扑或日志。
- conversation-tree 与 chat-core 仍无相互依赖。
- Electron 与 Renderer 未接入本功能。
- 专项测试、全仓测试、类型检查、构建和 boundary lint 全部通过。

## 22. 明确不做的内容

- Electron IPC、Preload API 和前端 UI。
- 会话树持久化到数据库或文件。
- 跨 CLI 进程恢复 cursor。
- 上下文摘要、token 预算裁剪或 RAG。
- tool call、图片、音频等多模态节点。
- 将 streaming/failed/cancelled 状态写入 ConversationNode。
- 自动合并分支或 reparent 节点。
- 在树中保存 ProviderConfig、API Key、Base URL 或原始响应。

完成本计划后，应先停在 runtime + CLI 调试层，等待下一阶段 Electron 接入指令。
