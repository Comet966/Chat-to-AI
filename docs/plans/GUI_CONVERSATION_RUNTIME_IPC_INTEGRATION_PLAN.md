# GUI 会话内核与 Electron IPC 接入计划

## 1. 目标与边界

本计划承接已完成的 GUI 会话树前端，接入既有的 `chat-conversation-tree`、`chat-conversation-runtime`、`chat-core` 和多协议模型适配器，使 Electron GUI 可以进行一次真实的、单窗口单会话树的流式对话。

用户在树中显式选定当前节点后，下一次发送消息必须以“根节点到当前节点”的唯一路径构造上下文；流结束后由 `ConversationRuntimeService` 自动持久化 User/Assistant 节点，并将最新快照推回 GUI。Renderer 不得直接访问 API Key、模型适配器、内核、存储库或 `ipcRenderer`。

本阶段只做运行时接入，不做持久化、账户体系、配置密钥存储、模型目录拉取、多会话列表、跨窗口同步、Markdown 渲染或新的视觉设计。

### 1.1 本阶段必须交付

1. 在 Main Process 中组合已有会话树、运行时、`ChatKernel` 与模型适配器。
2. 通过受校验、最小暴露面的 preload Bridge 提供会话读取、选中节点、发起流式请求和取消请求能力。
3. Renderer 将 `DemoChatUiAdapter` 与 `DemoConversationTreeUiAdapter` 替换为独立的 Electron Adapter；Port 形状保持 Renderer 侧稳定。
4. 对话消息按增量事件实时显示；请求完成后树自动刷新并把 current node 移到 Assistant 节点。
5. 从树中选择节点仅切换会话游标；不会静默发起请求，也不会直接更改节点内容。
6. 所有 IPC 输入、输出和事件都经过共享 DTO/schema 校验，所有 IPC handler 都校验 sender。
7. 所有现有单元测试继续通过，并新增 transport、preload、Renderer Adapter、流式整合及安全回归测试。

### 1.2 明确不做

- 不让 Renderer 传递、读取或保存 API Key、Base URL。
- 不让供应商配置预览页直接修改 Main Process 运行时配置；本阶段真实模型配置只由 Main Process 的环境变量/`.env` 加载。
- 不直接把现有 Demo 的“任意角色新增节点”和“批量删除”接入真实内核。它们需要独立的领域命令和版本冲突策略，留到后续会话管理阶段；真实模式下应隐藏或禁用，并清楚说明原因。
- 不改变 core runtime 既有的“流结束后才写入 Assistant 节点”语义，也不在 Renderer 拼装上下文。
- 不使用 `webContents.executeJavaScript`、`remote`、关闭 `contextIsolation`、放宽 CSP 或通配 IPC channel。

## 2. 前置条件、分支与提交范围

开始前必须先完成并提交会话树前端分支的全部代码与测试；不得把未提交的 `docs/todo.md` 内容混入本阶段提交。

建议流程：

```text
dev
 └─ feat/gui-conversation-tree   # 已完成、验收后合并回 dev
     └─ feat/gui-conversation-runtime-ipc
```

实际执行前：

1. 确认 `feat/gui-conversation-tree` 已通过 GUI、类型、边界、全量测试和人工 Electron 验收。
2. 将它合并至最新 `dev`，或基于其已提交的等价提交创建新分支。
3. 在新分支运行 `pnpm typecheck`、`pnpm lint:boundaries`、`pnpm test`、`pnpm build:desktop`，记录基线。
4. 确认 `.env` 在 `.gitignore` 中，且没有被追踪；示例文件只可使用占位符。

提交建议按“共享协议与 Main 服务”“preload 与 Renderer Adapter”“页面接入与测试”拆分。不要提交真实凭据、构建产物、调试日志或任何 Provider 返回的敏感内容。

## 3. 运行时架构

```text
Renderer
  ChatPage / MessageList / SessionTreePanel
       │ uses Ports only
       ▼
ElectronChatUiAdapter + ElectronConversationTreeUiAdapter
       │ window.desktopApi.conversation
       ▼
Preload contextBridge (allow-listed immutable API)
       │ ipcRenderer.invoke / subscribed event channels
       ▼
Main IPC Transport (schema + SenderPolicy)
       │
       ▼
DesktopConversationApplicationService
  ├─ ConversationTreeService + in-memory repository
  ├─ ConversationRuntimeService + cursor store
  ├─ ChatKernel as StreamingChatExecutor
  └─ runtime config loaded only in Main Process
       │
       ▼
chat-model-adapters -> OpenAI-compatible / Anthropic / Gemini
```

依赖方向必须保持：

```text
Renderer feature -> Renderer Port -> Renderer Electron Adapter -> preload DTO
Main transport -> Main application service -> existing runtime/tree/core packages
```

禁止反向依赖：

- Renderer 不导入 `electron`、`chat-core`、`chat-conversation-tree`、`chat-conversation-runtime`、`chat-model-adapters`。
- preload 不导入会话领域服务和模型适配器。
- shared contract 不导入 Electron、React 或任何模型 SDK。
- 领域包不导入 `apps/desktop`。

## 4. 运行时行为与一致性规则

### 4.1 单会话树生命周期

- 本阶段每个 Electron 主窗口只维护一个 Main Process 生成的 `treeId`；Renderer 不可指定任意 tree ID。
- 首次读取时树不存在，GUI 显示空状态；首次发送由 runtime 创建根 User 节点。
- 运行时树和游标仅内存保存。关闭应用后丢失属于本阶段预期，UI 必须避免给出“已保存”的暗示。
- Main 负责把 core snapshot 映射为 GUI snapshot，包括 `revision`、`rootId`、`currentNodeId`、节点 role/content/sequence/time/provider/model。

### 4.2 发送与流式事件序列

严格时序：

```text
Renderer send(text)
  -> invoke conversation.turn.start
  <- accepted(requestId)
  <- event turn.started
  <- event turn.delta (0..n)        # UI 立即追加增量
  <- event turn.completed | failed | cancelled
  <- event tree.snapshot.changed    # completed 后读取/推送最终快照
```

- 一个树同一时刻至多一轮请求；重复发送返回可展示的 `TURN_IN_PROGRESS` 类错误。
- Renderer 必须按 `requestId` 过滤事件；旧窗口、旧树或未知请求的事件不得改当前 UI。
- 消息增量只更新临时 Assistant 气泡，不能每个 delta 都要求树重新布局。
- 只有 completed 后 Assistant 节点已被 runtime 成功写入时，才发布最终 tree snapshot。
- failed/cancelled 保留已显示的用户输入和临时 Assistant 内容的展示策略必须明确：显示失败/取消状态，但不能伪造已完成 Assistant 节点。
- 取消使用 runtime 的 `cancelTurn`，不可只在 Renderer 中停止渲染。

### 4.3 当前节点与上下文

- 用户单击图节点仍只改变临时 selection。
- 用户点击“设为当前”后，Renderer 通过 Port 发送节点 ID；Main 调用 runtime 的节点选择能力。
- Main 在没有活跃 turn 时允许切换；有活跃 turn 时返回可展示错误，树和游标保持原样。
- 下一次 `send` 不接受 Renderer 提供的历史消息数组；运行时使用受控 tree ID 与当前游标构建根到当前节点路径。
- completed 后 current node 自动移到新 Assistant 节点，树的 current-path 高亮更新。

## 5. 共享契约与 IPC 规范

新增桌面会话契约应放在 `apps/desktop/src/shared/`，并以 Zod 为唯一校验来源。可按现有 `desktop-api.contract.ts` / `desktop-api.schemas.ts` 的模式拆分为 contract、schema、channels；避免把 Renderer UI DTO 直接复用为领域实体。

### 5.1 最小能力集合

使用单独的 `desktop:conversation:*` 命名空间，至少包含：

| 能力 | 调用方向 | 说明 |
|---|---|---|
| 获取快照 | invoke | 返回空树或当前 GUI tree snapshot |
| 订阅事件 | Main -> Renderer | 仅推送已定义的 turn/tree 事件 |
| 设置当前节点 | invoke | 有效节点且无活跃 turn 才更新游标 |
| 启动会话轮次 | invoke + event | 接收纯文本 prompt；返回 requestId/accepted |
| 取消会话轮次 | invoke | 只能取消当前 Main 维护的请求 |
| 可选刷新 | invoke | 用于重试/恢复显示，不创建新树 |

本阶段不要暴露通用 `invoke(channel, payload)`、任意 node 查询、任意 tree ID、文件系统操作或 Provider 配置写入接口。

### 5.2 DTO 规则

- 输入使用严格对象 schema，拒绝未知字段、超长 prompt、空字符串和不合法 ID。
- 输出只使用 JSON 可克隆数据；不返回 Error、class instance、function、`undefined`、原始 HTTP response 或 API Key。
- 错误必须使用稳定 code + 面向用户的安全 message；不要把 HTTP headers、URL query、栈、原始 provider body 或环境变量回传。
- 事件必须包含 schema version（如有需要）、tree/request ID、事件类型和最小必要 payload。
- 对树快照限制节点内容与节点数量的 IPC 体积上限；超过限制返回可恢复错误，不能让主进程或 Renderer 无限制分配内存。

### 5.3 Sender 与窗口隔离

- 每个 handler 使用既有 `SenderPolicy` 或等价的顶层 frame + origin 检查。
- event 只发送给发起该请求的 `webContents`，并在发送前检查未销毁。
- 在窗口关闭、导航、host shutdown 时取消活跃请求、移除 handler/listener，并清空对该 webContents 的引用。
- Main 不信任 Renderer 声明的 request ID、provider、model、tree ID 或 current node；所有这些由 Main 维护或严格比对。

## 6. Main Process 实施要求

### 6.1 应用服务与组合根

新增 Main 专属的会话应用服务（命名可调整），负责持有：

- `InMemoryConversationTreeRepository`；
- `ConversationTreeService`；
- `ConversationRuntimeService`；
- 按环境配置创建的模型适配器与 `ChatKernel` executor；
- 当前窗口对应的受控 tree ID、活跃 request 与订阅者。

要求：

1. `ElectronHost.initialize` 只注册基础安全与 Shell；会话运行时在单独、可失败处理的初始化阶段组合。
2. 未提供环境配置时，应用仍可打开，但会话能力返回“尚未配置”的安全错误；不得因缺凭据令整个 GUI 崩溃。
3. `loadAppConfig`、模型适配器和 kernel 只在 Main 导入与实例化。
4. 流事件从 runtime 映射为桌面契约事件；不得将 `chat-contracts` 低层事件不经语义转换直接泄漏给 Renderer。
5. completed、成功 select、以及未来允许的树 mutation 后，服务发布一个经过映射的最新 snapshot。
6. 所有 version conflict、树不存在、无效节点、请求冲突、取消、模型失败必须明确转换为桌面错误码。

### 6.2 真实树 mutation 的限制

真实模式的节点创建仅来自 `ConversationRuntimeService.sendMessage`：它写入 User 和完成后的 Assistant 节点。这样可以保持流、树版本和上下文的一致性。

现有 GUI 的“新增节点”“删除所选”是前端 Demo 能力，不可直接调用 core 的 append/fork/delete：

- append/fork 需要受控的 `expectedVersion`、节点 ID 和领域规则；
- 批量删除当前 core API 需要逐节点协调冲突与游标回退策略；
- 在 turn 中删除会破坏事件与树版本对应关系。

真实 Adapter 应把这些按钮隐藏/禁用，显示“此操作将在会话管理阶段接入”；不要悄悄使用 Demo Adapter 来混合真实和假数据。后续计划单独定义“编辑树命令服务”。

## 7. Preload 与 Renderer 实施要求

### 7.1 Preload Bridge

- 在 `contextBridge` 下暴露一个冻结的 `desktopApi.conversation` 子对象。
- 只导出第 5 节列出的具名方法与 `onEvent`，每个订阅都返回精确的 unsubscribe 函数。
- 调用结果和事件 payload 先按共享 schema 解析/克隆再交给 Renderer。
- 保留 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；不向 `window` 暴露 Node/Electron 原对象。
- 更新 `env.d.ts` 使窗口类型来自共享契约，不使用 `any` 或全局未声明字段。

### 7.2 Renderer Adapter

新增两个独立 Adapter：

- Chat Adapter：维护消息列表、临时 streaming Assistant、request status、错误与取消；把 desktop event 转为现有 `ChatUiPort` 状态。
- Tree Adapter：把 desktop snapshot 适配为 `ConversationTreeUiPort`，维护订阅、set-current、reload；真实模式不实现任意新增/删除，而是返回稳定的“不支持”结果。

`App` 的 Port 组装需有明确运行模式：

- Electron Bridge 存在时使用真实 Adapter。
- 仅在显式 preview/test 模式使用 Demo Adapter。
- 不得因 Bridge 缺失静默回落到 Demo 并假装已连接真实服务；需显示“桌面服务不可用”。

### 7.3 页面微调

- `ChatPage` 继续只依赖 `ChatUiPort` 与 `ConversationTreeUiPort`，不接触 desktop API。
- `MessageList` 支持临时流式气泡、完成、失败、取消，不负责树写入。
- Composer 在 request 活跃时禁用重复发送，提供取消入口。
- Tree panel 订阅正式 snapshot，completed 后重算一次布局；每个 delta 不重排。
- 在连接/未配置/请求冲突/模型错误时展示无凭据泄漏的错误信息。

## 8. 测试矩阵

### 8.1 共享契约与 Preload

- 每个 invoke 输入的有效、空、超长、未知字段与错误类型。
- 每个 event payload 的解析、克隆和 unsubscribe。
- window 类型不包含未授权 API。
- Preload 不暴露 `ipcRenderer`、`require`、环境变量或通用 invoke。

### 8.2 Main application service

- 空树首次 send 创建正确 User root，随后流完成创建 Assistant 节点。
- 选择非叶节点后 send 的 executor 收到根到该节点路径加新 prompt，且不混入其他分支。
- 多个模型/协议产生的 Assistant metadata 正确映射到 snapshot。
- delta 按序转发，completed 后只发布一次最终快照。
- cancelled、provider failure、空响应、version conflict、重复 send 的树和游标保持一致。
- 选中不存在节点、turn 进行中切换、未配置 runtime 都返回安全错误。

### 8.3 Electron transport

- 每个 handler 拒绝非顶层 frame、错误 origin、无效 schema。
- 仅原发起 sender 收到流事件；窗口销毁后不会 send。
- handler 注册与 shutdown 后清理无泄漏、重复注册不冲突。
- 取消确实调用 runtime cancel，而非仅停止 Renderer 显示。

### 8.4 Renderer

- 真实 Chat Adapter 根据 started/delta/completed/failed/cancelled 正确转状态。
- 真实 Tree Adapter 将 snapshot 更新传至面板；set-current 后 current path 更新。
- Demo 和真实运行模式不可混合。
- 单击节点不改 current；明确“设为当前”才发 invoke。
- 流式 delta 不触发树重新布局；completed 后新 Assistant 节点可见且是 current。
- 真实模式下树编辑控制符合禁用与解释要求。

### 8.5 回归与人工验收

自动化命令：

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
```

人工 Electron 验收：

```bash
AI_API_BASE_URL='https://…' \
AI_API_KEY='…' \
AI_MODEL_ID='…' \
AI_PROVIDER='openai-compatible' \
pnpm --filter chat-desktop run dev
```

手工检查：

1. DevTools Console 没有 CSP、preload 或 IPC sender 拒绝以外的错误。
2. 首条消息、连续消息、从历史节点分支后的消息都实时流式显示。
3. `/tree` 等 CLI 输出不属于本阶段 GUI 验收；应在 GUI 中确认拓扑与路径。
4. 取消时请求真正终止，树不出现伪造的完成 Assistant 节点。
5. 网络失败/错误密钥不泄露 URL 中凭据、headers 或栈。
6. 关闭窗口时无未处理 rejection、无悬挂 IPC handler。

## 9. 完成标准与交付报告

下列条件全部满足才可归档本计划：

1. GUI 在有效 Main Process 配置下能完成真实、可见的流式对话。
2. 发送上下文严格来自 root 到 current node 的路径；分支不会串上下文。
3. completed 后树自动包含 User/Assistant 节点，current node 指向新 Assistant。
4. 取消、失败、无配置和重复请求可恢复且不破坏树。
5. Renderer、preload、Main 与 core 的依赖边界和 Electron 安全策略均通过检查。
6. 所有自动化命令通过，且有一次真实 Electron 手工验证记录。
7. API Key 没有进入 Renderer、IPC payload、日志、测试快照或 Git。
8. Demo-only tree 编辑能力未被错误地用于真实模式。

执行 Agent 的交付报告必须包含：实际分支与提交范围、运行模式选择、IPC channel 列表、契约校验策略、测试结果、手工验证结果、已知限制（内存树/环境配置/未接入树编辑）以及任何安全或兼容性遗留项。
