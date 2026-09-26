# GUI 前后端与会话内核对接计划

> 状态：待执行
>
> 基线：`feat/gui-conversation-tree-react-flow` 分支，提交 `bf210c3` 及其后续文档提交
>
> 适用范围：Electron GUI、Preload IPC 隔离层、会话运行时、供应商配置
>
> 本文取代此前同名计划；执行 Agent 不应再按“一条内核消息对应一个前端树节点”的旧假设实施。

## 1. 目标

在不破坏现有内核、Electron 安全边界和 React Flow 前端结构的前提下，把当前演示用 GUI 接入真实会话运行时，使用户能够：

1. 在供应商配置页配置 OpenAI-compatible、Anthropic 或 Gemini，并选择实际使用的模型。
2. 在主界面发送消息并实时看到流式增量，而不是等待完整答案后一次性显示。
3. 在会话树中查看每一轮完整问答，切换当前轮次，并从历史轮次创建分支。
4. 选择“根路径继承”或“自由选择继承”，且两种模式都由 Main/内核构造上下文。
5. 在取消、模型失败、无配置、窗口关闭等情况下保持树、游标和界面状态一致。

本阶段仍为单窗口、单会话树、单活跃请求。树和配置可以先保存在 Main Process 内存中；持久化、多会话列表、账户同步、附件和富媒体不在本计划范围内。

## 2. 开始前的仓库要求

### 2.1 分支

执行时从已验收并推送的 `feat/gui-conversation-tree-react-flow` 创建新的工作分支，建议命名：

```text
feat/gui-conversation-tree-react-flow
└── feat/gui-runtime-integration
```

不要从旧的 `feat/gui-conversation-runtime-ipc` 工作树或 stash 继续开发。旧 stash 只能作为人工参考，禁止直接恢复后覆盖现有 React Flow 代码。

### 2.2 基线检查

在修改前记录以下命令结果：

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
```

若基线已经失败，应先报告而不是通过删测试、放宽类型或跳过校验绕过问题。真实 API Key、请求响应、构建产物和调试日志不得进入提交。

### 2.3 建议提交边界

每完成一个可独立回退的阶段提交一次：

1. `refactor(runtime): support explicit context selection`
2. `feat(desktop): add conversation projection and application service`
3. `feat(desktop): add validated conversation IPC bridge`
4. `feat(desktop): connect renderer chat and tree adapters`
5. `feat(desktop): connect provider settings runtime`
6. `test(desktop): cover GUI runtime integration`

提交名称可调整，但不得把所有改动压成一个难以审查的提交。

## 3. 必须先统一的领域语义

这是本计划最重要的约束。实现 Agent 必须先完成本节的单元测试，再开始页面接线。

### 3.1 内核节点与前端节点不是同一种节点

现有 `chat-conversation-tree` 中，每个节点是一条消息：

```text
User message -> Assistant message -> User message -> Assistant message
```

当前 GUI 中，每个圆形节点代表一轮完整问答：

```text
Turn(question + answer) -> Turn(question + answer)
```

不得修改 GUI，令其重新显示一条消息一个节点；也不得为了迁就 GUI，破坏内核已有的消息树模型。应在 Main Process 应用层增加“轮次投影器”，负责两种模型之间的转换。

### 3.2 问答轮次投影规则

一个可提交到 GUI 的轮次由以下两条内核消息组成：

- 一个 `user` 节点；
- 该 User 节点的一个直接 `assistant` 子节点。

规则如下：

1. 以 Assistant 节点 ID 作为稳定的 GUI `turnId`。Main 内部同时保留 `turnId -> userNodeId + assistantNodeId` 映射。
2. 同一 User 节点若因重新生成而有多个 Assistant 子节点，每个 Assistant 都投影为独立轮次；它们共享问题文本，但答案和 `turnId` 不同。
3. GUI 轮次的父轮次，是当前 User 节点祖先链上最近的 Assistant 节点对应的轮次。
4. 首轮问答的父轮次为空，因此它是 GUI 树根。
5. Provider/model 元数据来自 Assistant 节点的生成信息。
6. 只有完整的 User + Assistant 对才能进入已提交的 GUI 树。请求过程中、失败或取消后遗留的孤立 User 节点不能显示成“已完成轮次”。
7. 投影必须校验结构；遇到角色顺序错误、悬空父节点、重复 ID 或无法确定父轮次时返回明确错误，不能猜测修复后继续展示。

前端只能看到轮次 DTO，不能看到或拼装内核原始消息数组。

### 3.3 当前轮次与树挂载位置

GUI 的 `currentNodeId` 表示当前轮次 ID。Main 将它解析为该轮次的 Assistant 消息节点，并把新问题挂载在这个 Assistant 节点下。

必须区分两个概念：

- **挂载位置**：新问答轮次在树上成为哪个当前轮次的子轮次。
- **上下文选择**：本次模型请求携带哪些历史问答。

切换上下文继承模式不会改变挂载位置；自由勾选若干轮次也不会自动切换 current。只有明确执行“设为当前”才改变后续分支的父轮次。

请求完成后，新 Assistant 消息成为内核游标，新投影轮次成为 GUI current。

## 4. 两种上下文继承模式

### 4.1 根路径继承

“根路径继承”使用 GUI current 对应的 Assistant 消息作为基点，取得从内核根到该 Assistant 的唯一消息路径，再在末尾添加本次 User prompt。

Renderer 不发送历史文本。它只发送当前选择的继承模式和必要的、不透明轮次 ID；Main 验证 ID 后由运行时读取树并构造消息列表。

### 4.2 自由选择继承

“自由选择继承”接收一组 GUI 轮次 ID。Main 必须：

1. 校验 ID 均属于当前窗口受控的同一棵树；
2. 去重并拒绝不存在、未完成或结构无效的轮次；
3. 按轮次 `sequence` 升序确定稳定顺序，不依赖点击先后或 React Set 的迭代细节；
4. 将每一轮展开为 User、Assistant 两条消息；
5. 将本次 User prompt 放在最后；
6. 再执行消息数、单条长度和总长度限制。

自由选择允许跨分支选择，所以它是一段按创建顺序排列的“显式上下文”，不是树上的路径。UI 应以继承高亮提示用户哪些轮次会进入下一次请求。

空选择的语义必须固定：在已有树上应拒绝发送并提示用户至少选择一轮；全新空树的首条消息可以没有历史上下文。

### 4.3 运行时扩展要求

现有 `ConversationRuntimeService` 只会从新 User 节点读取根路径，无法正确表达自由选择。应在 runtime 层增加受控的上下文选择能力，但不要让 runtime 依赖 Electron 或 GUI DTO。

建议使用领域级联合类型表达：

- 根路径：由挂载基点构造路径；
- 显式消息：由应用层解析得到的、有序内核消息节点 ID 集合。

运行时仍应自己从树服务读取节点内容并校验角色顺序；不能接受 Renderer 或 Main 传来的任意 `role/content` 数组。上下文构造函数应同时覆盖两种来源，并复用现有长度限制。

## 5. 整体架构与依赖方向

```text
Renderer 页面与组件
  ChatPage / ProviderSettingsPage / SessionTreePanel
              │ 仅依赖 Renderer Ports
              ▼
Renderer Electron Adapters
  Chat / ConversationTree / ProviderSettings
              │ window.desktopApi 具名能力
              ▼
Preload contextBridge
  白名单方法、事件订阅、结构化克隆
              │ validated IPC
              ▼
Main Transports
  schema 校验 + SenderPolicy + 生命周期清理
              ▼
Desktop Application Services
  会话协调 / 轮次投影 / Provider 配置
              ▼
ConversationRuntime + ConversationTree + ChatKernel
              ▼
OpenAI-compatible / Anthropic / Gemini adapters
```

依赖边界必须满足：

- Renderer feature 只依赖 Renderer Port，不能导入 Electron、内核包或模型适配器。
- Electron Adapter 是 Renderer 中唯一允许调用 `window.desktopApi` 的层。
- Preload 只做能力收窄、校验、克隆和订阅清理，不组合业务服务。
- Main transport 不实现领域逻辑，只负责 IPC、安全和错误映射。
- shared contract 不导入 React、Electron、Node API 或领域 class。
- `chat-conversation-runtime` 不依赖 `apps/desktop`。
- API Key 和供应商原始错误只存在于 Main，不进入 Renderer 日志、事件或快照。

## 6. Main Process 应用层

### 6.1 会话应用服务

新增一个 Main 专属会话应用服务，负责组合并持有：

- 内存会话树 repository 和 `ConversationTreeService`；
- `ConversationRuntimeService` 及 cursor store；
- 当前窗口唯一的 tree ID；
- 当前可用模型执行器；
- 轮次投影器和 GUI turn/core node 映射；
- 当前活跃 request 与其所属 `webContents`。

服务对 transport 提供的业务能力至少包括：读取轮次快照、设置当前轮次、开始一轮、取消一轮、订阅语义事件，以及刷新快照。

不要向 transport 暴露 repository，也不要允许 Renderer 自行指定任意 tree ID、request ID 或模型执行器。

### 6.2 启动一轮的原子输入

启动命令应把以下信息作为同一次请求的不可分割输入：

- prompt；
- 当时的 current turn 或快照 revision；
- 继承模式；
- 自由选择时的有序 turn IDs。

这样可避免用户点选上下文后、发送前树发生变化导致请求读取另一套状态。Main 应验证 revision/current，冲突时要求 Renderer 刷新，而不是静默套用新状态。

request ID 由 Main/runtime 生成。启动成功只表示请求已被接受，不表示模型已完成。

### 6.3 流式事件时序

语义时序固定为：

```text
turn.start invoke
  -> accepted(requestId)
  -> turn.started
  -> turn.delta (0..n)
  -> turn.completed | turn.failed | turn.cancelled
  -> completed 后发布一次 conversation.snapshot.changed
```

要求：

1. 同一树只允许一个活跃 turn。
2. 所有事件带 request ID；Renderer 忽略未知或过期请求。
3. delta 只更新临时 Assistant 气泡，不触发树重新布局。
4. 只有 Assistant 成功写入树后才能发 completed。
5. completed 后只投影和推送一次新快照。
6. cancel 必须调用真实 executor/runtime 取消，不是仅在 UI 停止显示。
7. 窗口关闭或导航离开受信页面时取消活跃请求并清理订阅。

### 6.4 失败和取消的补偿策略

现有 runtime 会在模型完成前写入 User 节点，因此失败、取消、空响应或启动拒绝可能留下孤立 User 节点。对接前必须修正这一点并添加测试。

本阶段采用以下一致策略：

- 记录请求前的挂载基点和树版本；
- 终态不是 completed 时，删除本轮刚创建且没有子节点的 User 节点，并把 cursor 恢复到请求前基点；
- 首轮失败时，若树只包含该 User 根，应删除整棵临时树并恢复为空状态；
- 若补偿遇到版本冲突，不得假装成功，应返回稳定错误并强制客户端重新读取快照；
- 不向 GUI 推送包含孤立 User 的“正常轮次快照”。

补偿必须在 runtime/领域应用层完成，不能由 Renderer 猜测删除。

## 7. 供应商配置与模型执行器

### 7.1 配置所有权

供应商配置由 Main Process 持有。Renderer 可以提交配置，但读取时不得得到完整 API Key；返回值只应说明是否已配置密钥，并可返回脱敏提示。

首阶段允许配置只存内存。若实现 Agent 选择落盘，必须先单独提出凭据存储方案并使用系统安全存储；禁止把明文 API Key 写入普通 JSON、localStorage、日志或测试快照。

### 7.2 配置生效

保存配置时 Main 应：

1. 校验 provider、Base URL、模型 ID、token 上限及 Provider 特有字段；
2. 规范化 URL，并拒绝带凭据的 URL；
3. 用新的配置创建候选 model adapter/executor；
4. 通过最小请求或已有模型列表能力验证连接；
5. 成功后原子替换当前执行器，失败时保留上一个可用配置。

若当前有活跃 turn，应拒绝切换配置，不能让同一轮中途更换 executor。

### 7.3 模型列表

当前内核没有统一模型目录接口时，不要在 Renderer 直接发 HTTP。应新增 Main 侧 provider model catalog port，把 OpenAI-compatible、Anthropic、Gemini 的差异封装在适配器中。

对于不支持远程枚举或供应商拒绝枚举的情况，应返回明确的“可手工输入模型 ID”状态，而不是伪造列表。模型列表响应需要限制数量、去重、稳定排序和超时。

### 7.4 环境变量兼容

保留现有环境变量作为开发启动的初始配置来源。GUI 保存的新配置只覆盖当前运行时内存，不修改 shell 环境或 `.env` 文件。

## 8. 共享契约与 IPC

在 `apps/desktop/src/shared/` 中集中定义 DTO、channel 常量和 Zod schema。Zod schema 是运行时边界校验来源，TypeScript 类型与其保持一致。

### 8.1 能力集合

按命名空间提供具名能力，避免通用 invoke：

| 命名空间 | 能力 |
|---|---|
| conversation | 获取快照、设置当前轮次、开始 turn、取消 turn、订阅会话事件 |
| provider | 获取脱敏配置、保存/清除配置、测试连接、获取模型列表 |
| app | 保留现有应用信息读取 |

channel 名称应继续使用 `desktop:*` 前缀。不得暴露文件系统、任意 URL 请求、任意 channel 调用或原始 `ipcRenderer`。

### 8.2 DTO 约束

- 所有输入对象使用 strict schema，拒绝未知字段。
- prompt、ID、节点数、事件 delta 和错误 message 都要有上限。
- DTO 只能包含可结构化克隆的数据；不返回 Error、class、函数、HTTP response 或 `undefined`。
- 错误使用稳定 code 和安全 message；原始 provider body、headers、stack、Key 和含凭据 URL 不得传出 Main。
- GUI snapshot 使用 `revision`；所有破坏一致性的写操作检查预期 revision。
- 事件包含 schema version、类型、request ID 及最小必要 payload。

### 8.3 Electron 安全要求

- 所有 handler 复用 `SenderPolicy`，校验顶层 frame 和允许的 origin。
- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` 保持不变。
- event 只发送给发起请求的存活 `webContents`。
- transport 注册可幂等清理；host shutdown、窗口关闭和测试 teardown 后不留 listener。
- preload 暴露冻结对象，每个订阅返回只移除自身 listener 的 unsubscribe。
- preload 交付 Renderer 前对调用结果和事件再次校验并结构化克隆。

## 9. Renderer 接入

### 9.1 Adapter 替换

实现三个互相独立的 Electron Adapter：

- Chat Adapter：维护用户消息、临时流式 Assistant、请求状态、错误和取消。
- Conversation Tree Adapter：读取/订阅真实轮次快照、设置 current、刷新。
- Provider Settings Adapter：读取脱敏配置、保存、清除、测试连接和模型列表。

应用组合规则必须显式：

- Electron Bridge 存在且校验通过时使用真实 Adapter；
- 只有显式 preview/test 模式才使用 Demo Adapter；
- Bridge 缺失时显示“桌面服务不可用”，不得静默回落 Demo 并冒充真实对话。

### 9.2 Chat 与继承选择协调

`ChatPage` 负责保存 `SessionTreePanel` 回调给出的 `ConversationInheritanceSelection`，并在发送时与 prompt 一起交给 Chat Port。

当前 `ChatUiPort.sendMessage(content)` 需要演进为接收一个发送输入对象。共享的继承选择类型应放到 Renderer 应用层公共 types 或 shared contract，不能让 chat feature 反向依赖 session-tree 组件文件。

保持以下行为：

- 切换继承模式、勾选节点本身不发请求；
- “设为当前”仍通过 Tree Port 单独执行；
- 发送期间冻结本轮使用的继承选择；用户后续操作只影响下一轮；
- completed 后新轮次成为 current，树只重排一次；
- failed/cancelled 后清理临时 Assistant，保留清晰状态和可重试的用户输入，但不能伪造完成轮次。

### 9.3 消息列表来源

进入或切换 current 后，聊天消息列表应从当前轮次的根路径投影恢复，而不是只依赖本页面进程内临时数组。自由上下文选择只控制下一次请求，不重写当前分支的可视聊天历史。

若第一阶段暂不实现路径消息恢复，必须在 UI 标出限制并列为阻塞验收项，不能把 Demo messages 与真实树混用。

### 9.4 树编辑能力

真实模式下，新轮次只能由真实会话完成产生。当前 Demo 的“手工新增问答节点”不得写入真实树。

删除能力涉及 User/Assistant 成对删除、子树、current 回退和版本冲突。本计划先完成接口与禁用态：

- Electron Tree Adapter 对尚未实现的新增/删除返回稳定的 `NOT_IMPLEMENTED`/能力不可用结果；
- UI 显示明确禁用说明；
- 不混用 Demo Adapter 修改真实快照。

若执行 Agent 要在本阶段实现删除，必须另写子计划和测试矩阵，不得顺手添加。

## 10. 分阶段实施步骤

### 阶段 A：运行时上下文能力和失败补偿

1. 为根路径/显式节点上下文增加领域级选择类型。
2. 扩展上下文构造器和 runtime command，确保内容仍从树服务读取。
3. 分离“树挂载基点”和“上下文来源”。
4. 实现失败、取消、空响应和启动拒绝的补偿。
5. 完成 runtime 单元测试和旧 CLI 回归。

通过条件：不启动 Electron，仅通过 runtime 测试即可证明两种继承模式、分支挂载和补偿均正确。

### 阶段 B：轮次投影与 Main 应用服务

1. 实现纯函数式轮次投影器及结构校验。
2. 组合 tree/runtime/kernel，建立窗口级会话应用服务。
3. 实现快照、current、start/cancel、事件转发。
4. 完成多 Provider 元数据和 revision 映射。

通过条件：使用 fake executor 测试完整 started/delta/completed 流程，无 IPC 参与。

### 阶段 C：IPC 与 Preload

1. 添加共享契约、schema 和稳定错误码。
2. 注册 conversation/provider transport 并接入 SenderPolicy。
3. 扩展冻结的 preload bridge 和 Window 类型。
4. 加入订阅、窗口销毁和 host shutdown 清理。

通过条件：transport/preload 测试证明非法 sender、非法 payload、越权 channel 和敏感错误均被阻断。

### 阶段 D：Renderer 真实 Adapter 与页面接线

1. 实现三个 Electron Adapter。
2. 让 `ChatPage` 协调继承选择和发送输入。
3. 用流事件驱动临时 Assistant 消息。
4. 用 completed snapshot 更新 React Flow 树。
5. 显式区分 real、preview/test、service unavailable 三种模式。

通过条件：Renderer 测试不需要真实网络，也能验证 delta 是逐次出现且树只在完成时刷新。

### 阶段 E：供应商配置与真实烟雾测试

1. 接入脱敏配置、连接测试和模型目录能力。
2. 验证三种协议各至少一次真实流式请求。
3. 验证从历史轮次分支、两种继承模式和取消。
4. 更新 README 的启动配置、限制和安全说明。

通过条件：自动化全部通过，并记录一次 Electron 人工验收；记录不得包含凭据或完整供应商响应。

## 11. 测试矩阵

### 11.1 Runtime

- 空树首轮根路径发送成功。
- current 分支发送只继承正确根路径。
- 自由选择跨分支轮次时按 sequence 展开为 User/Assistant 对。
- 自由选择包含重复、不存在、非完整轮次或超限节点时拒绝。
- 自由上下文与挂载位置彼此独立。
- OpenAI-compatible、Anthropic、Gemini metadata 均写入 Assistant。
- 并发发送返回 `TURN_IN_PROGRESS`。
- cancel、provider failed、rejected、throw、空响应均清理临时 User 并恢复 cursor。
- 补偿 version conflict 返回明确错误。

### 11.2 投影器与应用服务

- 线性消息链正确投影为问答轮次链。
- 分支、重新生成、多模型轮次的父子关系和元数据正确。
- 孤立 User 不进入 GUI snapshot。
- 非法角色结构、环、重复 ID 和缺失父节点失败关闭。
- current Assistant 正确映射为 current turn。
- delta 不发布树快照；completed 只发布一次。

### 11.3 IPC/Preload/Security

- 每个 invoke 的有效、空、超长、未知字段和错误类型。
- 非顶层 frame、错误 origin 和已销毁 sender 被拒绝。
- 事件只到原窗口，unsubscribe 后不再接收。
- 重复注册/注销无 listener 泄漏。
- Preload 不暴露 `ipcRenderer`、Node、env 或通用 invoke。
- 错误和配置 DTO 不含 API Key、headers、stack 或原始响应。

### 11.4 Renderer

- started/delta/completed/failed/cancelled 的状态迁移正确。
- delta 逐块追加同一个 Assistant 气泡。
- 请求期间不能重复提交，可以真实取消。
- 继承模式和选择在发送时被固定。
- 设置 current 与自由勾选互不混淆。
- completed 后树新增一个问答轮次并高亮 current。
- current 切换后消息列表显示该分支根路径。
- Bridge 缺失不会落入 Demo 假成功。
- 未实现树编辑能力有明确禁用态。

### 11.5 自动化命令

至少执行：

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
```

阶段 A 后还应单独运行会话相关回归，便于定位：

```bash
pnpm test:conversation-tree
pnpm test:conversation-runtime
pnpm test:test-cli
```

## 12. 人工验收流程

使用测试密钥通过环境变量启动 Electron；具体变量沿用仓库现有命名，README 中不得填写真实值。

依次验证：

1. 无配置时应用可启动，发送按钮给出可恢复提示，不崩溃。
2. 保存或加载 OpenAI-compatible 配置，发送消息时文本逐块出现。
3. 连续对话后，树中每一个圆形节点恰好对应一轮问答。
4. 把历史轮次设为 current 再发送，新轮次出现在其子分支。
5. 根路径继承不混入兄弟分支。
6. 自由选择跨分支轮次后，请求使用所选轮次，树仍挂在 current 下。
7. 流中点击取消，网络请求终止，树中不出现半成品轮次。
8. 错误 Key、断网和 Provider 错误不会泄露凭据或栈。
9. 分别用 Anthropic、Gemini 完成一次流式响应并确认 provider/model 元数据。
10. 关闭窗口后没有未处理 rejection、悬挂请求或重复 IPC handler。

## 13. 完成标准

下列条件全部满足后，本计划才可归档：

1. GUI 使用真实内核完成单会话树的流式对话。
2. 前端问答轮次投影与内核消息树之间的映射有独立测试。
3. 根路径和自由选择两种继承模式都由 Main/runtime 安全构造上下文。
4. 上下文选择不会错误改变树挂载位置。
5. 切换 current、历史分支、取消和失败均保持树与 cursor 一致。
6. Provider 配置不泄露密钥，三种协议均有自动化或人工烟雾记录。
7. Renderer/Main/Preload/Core 依赖边界和 Electron 安全策略通过检查。
8. 全量 typecheck、boundary lint、test 和 desktop build 通过。
9. README 已说明启动方式、配置来源、内存态限制和未实现的树编辑能力。

执行 Agent 的交付报告必须列出：工作分支、提交列表、实际 IPC 能力、轮次投影规则、继承语义、凭据处理策略、自动化结果、人工验收结果、已知限制和任何未完成项。禁止只写“已完成”而不附证据。
