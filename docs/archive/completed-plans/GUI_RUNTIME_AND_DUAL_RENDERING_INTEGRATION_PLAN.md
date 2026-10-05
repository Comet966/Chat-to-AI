# GUI 前后端结合与 Markdown / HTML 双渲染模式实施计划

> 文档状态：已完成并归档（2026-10-04）
>
> 编写日期：2026-10-04
>
> 执行基线：`feat/gui-runtime-integration`，基线提交 `0f0c3ff`（`gui-v0.1.0`）
>
> 实施范围：Electron Main、Preload 安全桥、Renderer Adapter、AI 对话界面、Markdown/HTML 消息渲染及测试

> 完成记录：真实 Main / Preload / Renderer 流式链路、会话树投影、供应商运行时、Markdown/HTML 安全渲染、流中切换、Adapter 生命周期及 sandbox-compatible CommonJS preload 均已实现并验证。后续待办改由 `GUI_USABILITY_PROVIDER_AND_STRUCTURED_OUTPUT_PLAN.md` 覆盖。

## 1. 计划定位

本任务不是从零搭建前后端通信。目前仓库已经具备以下能力：

- Main Process 中已有供应商运行时、会话应用服务、轮次投影器和 IPC transport；
- Preload 已通过 `contextBridge` 暴露受限的 conversation/provider 能力；
- Renderer 已通过 Port/Adapter 接入真实会话、供应商配置和会话树；
- 会话内核已支持流式事件、上下文选择、节点切换和完成后写入会话树；
- 当前工作区存在一版尚未提交的 Markdown/HTML 渲染雏形，包括模式按钮、消息渲染组件、样式、依赖和部分测试。

执行 Agent 必须先审查并复用这些代码，只补齐缺口。禁止复制一套并行 IPC、另建会话状态源，或把前端重新接到 Demo 数据。

本计划的最终目标是：在保持 Electron 安全边界和内核解耦的前提下，形成一条可验证的真实对话链路，并允许用户在界面中即时切换 Assistant 消息的 Markdown 或 HTML 展示方式。

## 2. 本阶段用户能力

完成后，用户应能够：

1. 在供应商页面配置 Provider、Base URL、API Key 和模型，并回到对话页面使用该配置。
2. 从当前会话树节点发送消息，实时看到 Assistant 的流式增量。
3. 在会话树中切换当前节点，聊天窗口同步显示从根节点到当前节点的完整问答路径。
4. 在同一个请求流式输出期间或完成后切换 Markdown/HTML 模式。
5. 默认以 Markdown 模式显示 Assistant 内容；HTML 模式只渲染经过严格净化的 HTML。
6. 切换渲染模式时不重新请求模型、不修改会话树、不丢失流式内容，也不改变上下文。
7. 在未配置、请求失败、取消、IPC 不可用等情况下看到明确且可恢复的状态。

## 3. 范围边界

### 3.1 必须完成

- 审计并收口现有 Main → Preload → Renderer 的真实会话链路；
- 验证供应商配置能够驱动真实模型执行器；
- 验证当前节点和上下文选择被正确传入会话运行时；
- 验证流式事件逐段进入同一个临时 Assistant 消息；
- 实现或完善 Markdown/HTML 双渲染模式及切换控件；
- 对 HTML 渲染建立明确的安全策略；
- 补齐单元测试、边界测试、集成测试和人工验收记录；
- 更新与本能力直接相关的 README 使用说明。

### 3.2 本阶段不做

- 不实现多窗口、多会话列表或会话持久化数据库；
- 不保存渲染模式到后端、会话节点或模型上下文；
- 不让 Renderer 直接访问模型供应商或 API Key；
- 不实现任意 Electron channel、任意网络请求或 Node.js 能力透传；
- 不实现 TeX、SVG、终端图片、附件、代码执行、网页脚本或交互式 HTML；
- 不实现 HTML 编辑器、Markdown 编辑器和消息内容二次修改；
- 不处理打包发布、自动更新、安装器或生产签名；
- 不借本任务重构会话树领域模型或改变已有上下文语义。

## 4. 不可破坏的设计原则

### 4.1 原始消息是唯一事实来源

会话树中只保存模型返回的原始字符串。不得保存渲染后的 HTML、React 节点、DOM 结构或经过 Markdown 转换的副本。

渲染模式属于 Renderer 的展示状态：

```text
raw assistant content
       │
       ├── markdown mode → Markdown parser → React elements
       │
       └── html mode     → HTML sanitizer → sanitized DOM
```

因此切换模式只触发重新渲染，不触发 IPC、模型请求或树写入。

### 4.2 前端不拥有领域逻辑

- Renderer 只通过 Port 使用能力；
- Electron Adapter 是 Renderer 中唯一允许访问 `window.desktopApi` 的层；
- Preload 只做能力收窄、schema 校验、克隆和订阅清理；
- Main transport 只负责 IPC、安全校验和错误映射；
- 会话挂载、上下文构造、树 revision 和请求生命周期继续由 Main/内核负责；
- Renderer 不拼装历史 `role/content` 数组，不自行决定树结构。

### 4.3 渲染模式不得污染通信契约

不要把 `renderMode` 添加到模型请求、会话节点、IPC 事件或 Provider 配置。当前阶段它是 `ChatPage` 级别的本地 UI 状态，默认值固定为 `markdown`。

未来若需要跨启动保存，应通过单独的用户偏好能力实现，不得复用会话或供应商接口。

### 4.4 用户消息保持纯文本

双模式只作用于 Assistant 消息。用户消息无论当前模式为何，都必须按纯文本显示，以防止用户输入被误解释为 HTML，也避免切换模式时改变用户原文的视觉语义。

## 5. 目标架构

```text
ProviderSettingsPage                         ChatPage / SessionTreePanel
        │                                                │
        └────────────── Renderer Ports ──────────────────┘
                                 │
                   Electron Renderer Adapters
                                 │
                  window.desktopApi（固定能力）
                                 │
                    Preload / contextBridge
                  校验、克隆、订阅与注销
                                 │
                     具名且白名单化的 IPC
                                 │
                  Main conversation/provider transports
                                 │
           DesktopConversationService / ProviderRuntimeService
                      │                          │
            Conversation Runtime       Model Adapter / Executor
                      │                          │
              Conversation Tree    OpenAI / Anthropic / Gemini

Assistant 原始文本 ──→ MessageContent
                         ├── Markdown renderer
                         └── sanitized HTML renderer
```

依赖方向只能自上而下。渲染层不得导入 Main、Preload、Electron 或任何模型适配器。

## 6. 现有代码的处理要求

执行前先查看 `git status` 和 `git diff`。当前工作区中的双渲染代码属于待审查雏形，不得使用 reset、checkout、clean 或重新生成 lockfile 的方式覆盖。

重点核对：

- `apps/desktop/src/main/conversation/`
- `apps/desktop/src/main/provider/`
- `apps/desktop/src/preload/desktop-api.ts`
- `apps/desktop/src/shared/*.contract.ts`
- `apps/desktop/src/shared/desktop-api.schemas.ts`
- `apps/desktop/src/renderer/src/adapters/`
- `apps/desktop/src/renderer/src/ports/`
- `apps/desktop/src/renderer/src/pages/ChatPage.tsx`
- `apps/desktop/src/renderer/src/features/chat/`
- `tests/desktop-*`

对于已经满足本计划的部分，只增加必要测试或小范围修正，不进行无收益改名和目录迁移。

## 7. 前后端结合要求

### 7.1 供应商配置链路

供应商配置由 Main Process 持有并生效。Renderer 提交配置后，只能读取脱敏状态，不能读回完整 API Key。

需验证以下闭环：

1. 设置页经 Provider Port 提交配置；
2. Electron Provider Adapter 调用受限的 preload 能力；
3. Main 校验配置并创建或替换模型执行器；
4. 连接测试和模型列表请求均由 Main 发出；
5. 保存成功后，对话页展示的 provider/model 信息与实际执行器一致；
6. 活跃请求期间禁止静默替换执行器；
7. 错误返回稳定、安全的信息，不包含 Key、header、响应原文或调用栈。

环境变量仍可作为开发启动的初始配置，但 GUI 不得修改 `.env` 或 shell 环境。

### 7.2 会话发送链路

发送操作必须以一次原子输入携带：prompt、期望 revision、当前轮次 ID 和上下文选择。Renderer 不得发送历史消息正文。

Main 应继续负责：

- 校验 current/revision；
- 从会话树解析根路径或显式选择的上下文；
- 生成 request ID；
- 保证单会话同一时间只有一个活跃请求；
- 调用当前 Provider 的流式执行器；
- 成功后把问答挂载到当前节点的子分支；
- 失败或取消时完成已有补偿，不留下伪完成节点。

### 7.3 流式事件链路

事件时序维持为：

```text
startTurn
  → accepted(requestId)
  → turn.started
  → turn.delta × 0..n
  → turn.completed | turn.failed | turn.cancelled
  → completed 后 snapshot.changed
```

Renderer Adapter 必须以 request ID 隔离事件：

- 只把当前请求的 delta 追加到当前临时 Assistant 消息；
- 忽略未知、过期和重复终态事件；
- delta 不触发会话树重排；
- completed 后以 Main 推送的 snapshot 为准进行最终对账；
- cancelled/failed 清理临时 Assistant 状态，不伪造已完成轮次；
- Adapter 销毁时解除订阅，避免页面重建后重复消费事件。

### 7.4 当前节点与消息投影

切换会话树 current 后，聊天窗口必须从 snapshot 中恢复该轮次从根到当前节点的唯一路径。消息列表不能只依赖本页面启动后的临时数组。

必须保持以下语义：

- current 决定新节点的挂载位置；
- context selection 决定模型收到的历史上下文；
- 两者不能相互替代；
- 成功响应后新轮次成为 current；
- 切换渲染模式不会更改 current 或 context selection。

## 8. Markdown / HTML 渲染要求

### 8.1 统一渲染入口

消息组件不得自行散落判断模式。应保留一个独立的 Assistant 内容渲染入口，输入仅包含：原始字符串、消息角色和当前模式。

推荐职责划分：

- `MessageList`：传递当前模式；
- `MessageItem`：负责消息外壳、角色和元信息；
- `MessageContent`：根据角色和模式选择安全渲染器；
- `RenderModeToggle`：只负责展示和发出模式变化；
- `ChatPage`：持有本页唯一的 render mode 状态。

不要让 Toggle 直接操作 DOM，也不要让 Markdown/HTML 组件订阅 IPC。

### 8.2 Markdown 模式

- 作为默认模式；
- 支持 CommonMark 基础语法和 GFM 常用扩展；
- 支持标题、段落、列表、引用、链接、表格、删除线、行内代码和代码块；
- Markdown 中夹带的原始 HTML 默认不执行，也不直接注入 DOM；
- 对空内容和流式过程中的不完整语法保持可显示，不得抛异常或让整个消息列表白屏；
- 样式只作用于消息内容容器，不能污染会话树和全局布局。

本阶段不承诺 TeX、Mermaid、SVG 或代码高亮。

### 8.3 HTML 模式

HTML 模式的语义是“将模型原始输出作为 HTML 片段安全展示”，不是自动把 Markdown 转换成 HTML。若模型输出的只是 Markdown 文本，切到 HTML 后允许表现为普通文本或浏览器对该片段的自然结果。

任何进入 `dangerouslySetInnerHTML` 的内容都必须先经过成熟 sanitizer。最低安全要求：

- 移除 `script`、`style`、`iframe`、`object`、`embed`、`form`、输入控件、`meta`、`base` 等主动或结构破坏元素；
- 移除内联事件属性、内联 style 及危险 URL scheme；
- 不允许脚本执行、表单提交、自动导航、资源注入或任意 Electron 能力调用；
- sanitizer 配置集中定义并有恶意样例测试；
- 不得为此放宽 Electron CSP、打开 `unsafe-eval` 或启用 Node integration。

如需支持链接，必须阻止它在应用 WebView 中直接导航。外链打开应另行通过受限 Main 能力设计；该能力不属于本阶段，可先禁用点击或保持无副作用。

### 8.4 模式切换按钮

- 放在对话页头部或消息区顶部，不遮挡供应商信息和会话状态；
- 文案明确为 `Markdown` 和 `HTML`；
- 使用真实 `button`，并提供组标签、选中状态和键盘可达性；
- 当前选中项需要有文字以外的状态语义，例如 `aria-pressed`；
- 默认选择 Markdown；
- 切换后立即作用于现有的所有 Assistant 消息和正在流式输出的消息；
- 不清空滚动位置，不重置输入框，不终止请求。

### 8.5 流式渲染策略

流式期间收到的内容可能是不完整的 Markdown 标记或 HTML 标签。渲染器必须容忍这种中间状态，并在后续 delta 到达后自然收敛。

性能要求：

- 不为每个 delta 重建整个应用或会话树；
- 保持消息行稳定 key，避免 Assistant 气泡反复卸载；
- 对消息内容组件使用合理的 memo 边界；
- 只有实际出现性能问题时，才在 Renderer 层按动画帧或很短的时间窗合并展示更新；
- 合并只能影响绘制频率，不能修改 delta 顺序、遗漏内容或延迟最终完成事件；
- canonical content 始终是按 sequence 拼接后的完整原文。

## 9. Electron 安全与契约要求

现有 Electron 安全设置必须继续保持：

- `contextIsolation: true`；
- `sandbox: true`；
- `nodeIntegration: false`；
- Main handler 校验顶层 frame 和受信 origin；
- Preload 不暴露 `ipcRenderer`、Node API、环境变量或通用 invoke；
- 所有 IPC 输入和输出经过共享 schema 校验；
- 所有订阅返回只注销自身 listener 的清理函数；
- 窗口关闭、导航和 Host shutdown 时清理 handler、listener 和活跃请求。

渲染模式不需要新增 IPC channel。若执行 Agent 发现必须新增，应先停止并说明原因，因为这通常表示展示状态错误地泄漏到了后端。

## 10. 实施阶段

### 阶段 A：基线审计与缺口清单

1. 记录当前分支、HEAD、工作区改动和依赖变更。
2. 执行 typecheck、边界检查、现有测试和 desktop build，记录基线结果。
3. 用 fake executor 追踪一次完整的配置、发送、delta、完成和 snapshot 更新。
4. 对照本计划列出已满足、需要修正、缺少测试三类项目。
5. 确认未提交的双渲染雏形是否符合安全和组件边界要求。

通过条件：有明确的最小修改清单，没有重复架构。

### 阶段 B：收口真实前后端链路

1. 修正 Provider 配置与执行器状态不同步的问题（如存在）。
2. 修正会话事件 request ID、终态或 snapshot 对账问题（如存在）。
3. 确保切换 current 会刷新根路径消息，并保持上下文/挂载语义。
4. 确保真实模式、预览模式和服务不可用模式不会互相伪装。
5. 补齐 Adapter 的订阅生命周期清理。

通过条件：使用 fake model 时，GUI 能完成可重复的端到端流式会话和节点切换。

### 阶段 C：完成双渲染组件

1. 审查并完善当前 `MessageContent` 和 `RenderModeToggle` 雏形。
2. 固定 Markdown 默认值和 Assistant-only 规则。
3. 集中 HTML sanitizer 策略，并覆盖危险输入。
4. 完善 Markdown/HTML 内容样式、溢出、表格和代码块显示。
5. 确保切换模式对历史消息和流式消息即时生效。

通过条件：纯 Markdown、纯 HTML、普通文本、混合内容、不完整流内容和恶意 HTML 均有确定表现。

### 阶段 D：流式稳定性与性能

1. 验证快速 delta 不丢失、不乱序、不重复。
2. 验证在流中反复切换模式不会打断请求。
3. 验证 completed snapshot 到达后不会短暂重复消息或清空答案。
4. 使用长列表和较长代码块观察重渲染；只在证据充分时增加轻量合并策略。
5. 确保会话树不随每个 delta 重新布局。

通过条件：测试和人工观察均能证明真正的逐段更新，而非完成后一次性输出。

### 阶段 E：测试、文档与交付

1. 完成第 11 节测试矩阵。
2. 更新 README：开发启动、供应商配置、双渲染模式、安全限制和已知非目标。
3. 使用至少一个真实 Provider 进行一次无敏感信息的烟雾测试。
4. 输出变更文件、命令结果、人工验收结果和已知限制。

通过条件：全部完成标准满足后才能归档本计划。

## 11. 测试矩阵

### 11.1 渲染组件

- Assistant 默认使用 Markdown；
- 用户消息始终按纯文本显示；
- Markdown 标题、列表、引用、链接、表格、行内代码和代码块可渲染；
- Markdown 原始 HTML 不被执行；
- HTML 常用安全标签正常显示；
- `script`、事件属性、危险 URL、iframe、form、style 等被净化；
- 普通文本、空文本和 Unicode 内容不崩溃；
- 不完整 Markdown/HTML 在每个流式中间态都不抛异常；
- 模式按钮默认值、点击、键盘操作和 `aria-pressed` 正确；
- 切换模式会重渲染全部 Assistant，但不改变用户消息。

### 11.2 Renderer Adapter

- start 成功后进入 streaming；
- 多个 delta 按 sequence 追加到同一 Assistant；
- 过期 request ID 的事件被忽略；
- completed、failed、cancelled 状态迁移正确；
- snapshot 对账后显示 current 的根路径消息；
- current 切换后消息和树选择一致；
- 页面/Adapter 销毁后事件 listener 被移除；
- Bridge 缺失时显示 unavailable，不回落为假成功 Demo；
- render mode 改变不调用 conversation/provider API。

### 11.3 Main / Preload / IPC

- 合法和非法 start input；
- revision/current 冲突；
- 未配置 Provider、活跃请求并发、取消和模型失败；
- 事件只发送给正确的存活窗口；
- schema 拒绝未知字段、超长内容和畸形事件；
- 非法 sender/origin/frame 被拒绝；
- Preload 返回结构化克隆结果并正确 unsubscribe；
- API Key、headers、stack 和原始响应不会进入 Renderer。

### 11.4 端到端场景

- 配置 Provider → 返回对话页 → 发送 → 多次 delta → 完成 → 树新增节点；
- 连续对话继承当前根路径；
- 从历史节点切换 current 并创建分支；
- 流式期间从 Markdown 切到 HTML 再切回，最终内容完整；
- 请求取消/失败后树中无伪完成节点；
- 重启开发窗口后无重复 IPC handler 或重复 delta；
- 至少使用 OpenAI-compatible、Anthropic、Gemini 中一个做真实烟雾测试，其余协议使用 fake/contract 测试覆盖。

## 12. 自动化命令

执行 Agent 应以仓库实际脚本为准，至少运行：

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
git diff --check
```

开发运行：

```bash
pnpm --filter chat-desktop run dev
```

如仓库实际脚本名称发生变化，应在交付报告中写明替代命令和原因，不得跳过等价检查。

## 13. 人工验收流程

1. 通过环境变量或设置页提供测试 Provider 配置，启动 Electron。
2. 打开设置页，确认密钥不可被读回，保存后可返回对话页。
3. 发送要求包含标题、列表、表格、引用和代码块的响应。
4. 观察回答是否逐段增长，并确认树在完成前不新增完成节点。
5. 在流中切换 HTML，再切回 Markdown，确认请求持续且最终文本无缺失。
6. 完成后切换两种模式，确认历史 Assistant 消息一起重渲染，用户消息不变。
7. 发送安全测试 HTML，确认脚本、事件属性、iframe、表单和危险链接不会执行。
8. 从树中选择历史节点，确认消息窗口显示其根路径；再发送一条消息形成分支。
9. 测试取消、错误 Key 和断网，确认错误可恢复且无敏感信息泄漏。
10. 关闭窗口，确认终端无悬挂请求、重复 listener 或未处理 rejection。

验收记录不得包含真实 API Key、完整请求头或供应商原始敏感响应。

## 14. 完成标准

以下条件全部满足，任务才算完成：

1. Electron GUI 使用真实 Main/Preload 会话链路，不以 Demo 数据伪装成功。
2. 供应商配置、流式请求、会话树写入和 current 切换形成完整闭环。
3. Markdown 是默认模式，HTML 模式可即时切换。
4. 只有 Assistant 内容参与富文本渲染，原始消息保持不变。
5. HTML 内容在进入 DOM 前必经集中、可测试的 sanitizer。
6. 切换模式不会请求模型、写树、改变上下文或中断流。
7. 流式事件无丢失、乱序、重复消费和过期请求串流。
8. Electron 安全配置和 Port/Adapter 依赖边界未被破坏。
9. 自动化检查全部通过，并完成至少一次真实烟雾测试。
10. README 和交付报告说明使用方式、安全边界、测试证据与已知限制。

## 15. 执行 Agent 交付格式

交付时必须列出：

- 实际工作分支和提交列表；
- 修改过的模块及各自职责；
- 前后端事件链路和渲染数据流的简述；
- HTML sanitizer 的允许/禁止策略；
- 测试命令及逐项结果；
- 人工流式与切换模式验收结果；
- 未完成项、已知限制和后续建议。

禁止只报告“已完成”或只附截图。截图可作为补充，但不能替代自动化测试和行为说明。
