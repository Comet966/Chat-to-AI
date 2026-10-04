# GUI 输入体验、供应商目录与结构化输出实施计划

> 文档状态：待执行
>
> 编写日期：2026-10-04
>
> 问题来源：`docs/todo.md` 第 24–37 行（问题 10.4）
>
> 前置基线：已归档的 GUI 运行时与双渲染计划；当前应用具备真实 IPC、单会话树、流式输出及 Markdown/HTML 两种安全渲染模式。

## 1. 目标

本阶段解决实际 GUI 调试中暴露的八类问题：

1. Assistant 流式输出时，用户仍可编辑下一条消息草稿；
2. 中文输入法确认候选词时，Enter 不会误发送消息；
3. Markdown 模式正确显示常用 LaTeX 数学公式；
4. HTML 模式可在严格安全策略下显示受限的内联 SVG；
5. 用户可在设置页编辑 Markdown 与 HTML 两套输出约束提示词；
6. 模型响应格式与当前渲染模式保持一致，并对混合 HTML/Markdown 有可预期的降级行为；
7. Anthropic“生成协议”和“模型列表协议”可以独立配置，适配本地代理；
8. 开发环境可按显式开关加载本地测试供应商预设，且不把密钥写进仓库。

本计划不改变会话树领域模型、流式协议、多 Provider 请求适配器的基本职责，也不引入持久化、账户体系或多会话列表。

## 2. 现状与根因分析

| 问题 | 现状根因 | 影响 |
| --- | --- | --- |
| 流式时无法编辑下一条 | `ChatComposer` 把 `streaming` 直接等同于 textarea `disabled`，草稿和发送状态共用一个控制路径 | 用户无法边阅读边整理下一问 |
| 中文 IME Enter 误发送 | `onKeyDown` 只判断 `Enter` 与 `Shift`，未判断原生 `isComposing` / `keyCode === 229` | 候选词确认被当作提交 |
| LaTeX 不显示 | Markdown 只有 GFM parser，没有 math AST 和公式渲染器 | `$...$` / `$$...$$` 被当作普通文本 |
| HTML 内嵌 SVG 被删除 | HTML sanitizer 使用 HTML-only profile，且当前策略为安全起见拒绝 SVG 相关节点 | 图表、公式或模型生成的内联图无法展示 |
| 无格式系统提示词 | Provider 设置只保存连接参数；会话运行时没有可配置的 synthetic system message 来源 | 模型不知道当前需要严格产出哪一种格式 |
| HTML/Markdown 混输 | 模型没有稳定格式契约；UI 只能把整段原文交给单一 renderer | 某一部分通常被显示为纯文本或被安全剥离 |
| Anthropic 模型列表不匹配 | 当前 `provider` 同时决定对话请求格式、模型目录路径、认证头和响应解析；本地代理常见“Anthropic Messages 生成 + OpenAI `/v1/models` 目录”组合无法表达 | 一键获取列表失败或得到不能用于当前端点的 ID |
| 本地测试重复配置 | GUI 不区分开发预设和用户配置；每次启动 Main 内存配置都会丢失 | 调试成本高，且容易诱导把凭据写入代码 |

## 3. 关键设计决策

### 3.1 草稿可以编辑，发送仍保持单活跃请求

“允许输入”不等于“允许并行请求”。本阶段保持每棵会话树仅一个 active turn：

- 流式期间 textarea 保持可编辑；
- 流式期间 Send 不启动第二个请求；Stop 保持可用；
- 已编辑的草稿保留在 Composer 本地状态，当前请求完成、失败或取消后可立即发送；
- 本阶段不实现自动排队发送，避免用户误以为请求已经提交；
- 如用户在流式时按提交快捷键，界面给出非阻塞提示，草稿不丢失。

这让会话运行时的并发约束继续由 Main/内核保证，Renderer 只改善编辑体验。

### 3.2 输入法组合态优先于提交快捷键

Composer 必须把 IME composition 看成文本输入的一部分。只有在以下条件同时满足时才处理 Enter 发送：

- `key === 'Enter'`；
- 未按 Shift；
- React 原生事件 `isComposing` 为 false；
- 兼容分支中 `keyCode !== 229`；
- 当前不存在 active turn。

应同时监听 composition start/end，以便可测试地维护组合状态。组合期间绝不调用 `preventDefault`、绝不清空草稿、绝不触发模型请求。

### 3.3 输出格式是“会话生成偏好”，不是 Provider 凭据

渲染模式与模型输出约束需要同步，但 API Key、Base URL、模型 ID 不应承担这一职责。

新增独立的非敏感偏好能力，名称可采用 `generationPreferences` 或同等语义，负责保存：

- 当前活动输出格式：`markdown` 或 `html`；
- Markdown 输出模板与用户可编辑覆盖文本；
- HTML 输出模板与用户可编辑覆盖文本；
- 模板版本/启用状态等非敏感元数据。

所有偏好由 Main Process 持有，Renderer 通过新的窄 IPC 能力读写。切换渲染模式时，同步更新该偏好；Main 在下一轮请求前根据冻结的偏好创建 synthetic system message。不要让 Renderer 把系统提示词或历史 messages 直接传进 `startTurn`。

当前正在流式的请求使用开始时冻结的格式偏好；用户在流中切换模式只影响展示和下一轮，不回写当前 Assistant 内容。

### 3.4 不用启发式“猜测”混合格式

模型输出格式不能靠前端正则可靠地区分。明确采用以下策略：

- Markdown 请求要求只输出 Markdown，不输出原始 HTML；
- HTML 请求要求只输出完整但不含 `<html>`/`<head>`/`<body>` 的 HTML fragment，不使用 Markdown 标记；
- 每个完成的 Assistant turn 记录其请求时的 `declaredOutputFormat` 和模板版本，作为展示建议，不改变原始 answer；
- 解析器永远按声明格式工作；若模型违规，保留原文并显示“格式与本轮约束不一致”的非阻塞提示；
- 用户仍可手动切换全局查看模式，但系统不得悄悄把 Markdown 转成 HTML 或把未净化 HTML 当作安全内容；
- “混合安全渲染器”属于后续独立能力，只有在定义 AST 边界和完整安全测试后才能加入。

这样避免模型输出中的意外标签跨越 HTML 安全边界，也使排查格式问题具备确定性。

### 3.5 模型目录协议与生成协议分离

Provider 类型继续只描述“发起流式对话时使用的协议”。新增独立的模型目录配置，至少表达：

- 目录模式：`provider-native`、`openai-compatible`、`manual-only`；
- 可选目录 Base URL（默认复用生成 Base URL）；
- 目录认证模式（默认由目录模式决定）；
- 是否允许自动探测，以及最后一次成功的目录模式/来源。

典型场景：生成仍使用 Anthropic Messages，但本地代理用 OpenAI-compatible 的 `/v1/models` 和 Bearer 认证提供列表。此时用户选择 Anthropic 生成协议与 OpenAI-compatible 目录协议即可。

不得默默改用另一个端点。若提供“自动探测”，它必须有固定、有限的候选顺序、总超时、清晰诊断，并将实际使用模式展示给用户。失败时保留手工填写 model ID 的能力。

## 4. 目标架构

```text
ProviderSettingsPage ──────────┐
OutputPreferencesSection ──────┼── Renderer Ports / Electron Adapters
ChatHeader render switch ──────┘                 │
                                                   ▼
                                       Preload named capabilities
                                                   │
            ┌──────────────────────────────────────┼──────────────────────────────────────┐
            ▼                                      ▼                                      ▼
 ProviderRuntimeService                 GenerationPreferencesService          ModelCatalogService
 generation protocol / key              output-format policy / templates       catalog protocol / parsing
            │                                      │                                      │
            └─────────────────── DesktopConversationService ───────────────────┘
                                              │
                        frozen synthetic system message + tree-derived context
                                              │
                                   Model adapter / stream events
                                              │
                           raw Assistant content + declared format metadata
                                              │
                        MessageContent: Markdown+math | sanitized HTML+SVG
```

依赖规则：

- Renderer feature 只依赖 Port，不导入 Electron、Main 或模型适配器；
- API Key 仍只在 Main；目录请求也必须由 Main 发起；
- 格式模板是非敏感数据，但仍须限长、校验和结构化克隆；
- 会话树保存原始 `question/answer`；渲染输出、KaTeX DOM 和净化后的 HTML 不写入树；
- 已完成 turn 的格式元数据须来自 Main 投影，而不是 Renderer 猜测。

## 5. 组件与接口边界

### 5.1 Composer

调整 `ChatComposer` 的职责：

- 输入状态始终独立于 `ChatUiStatus`；
- 通过 `canSubmit`、`canCancel`、`isComposing` 表达交互限制，不再把 streaming 映射为 input disabled；
- 提供草稿保留和轻提示所需的最小 props；
- 不在 Composer 内访问会话树、Provider 或 IPC。

`ChatPage` 继续负责读取 tree snapshot、发起发送和显示流状态。若用户在流中编辑草稿，页面重渲染不得重置 textarea。

### 5.2 输出偏好 Port

新增一组独立命名空间，例如 `preferences`，而不是向 `provider` DTO 塞入提示词。能力范围：

- 获取脱敏、可结构化克隆的输出偏好；
- 保存合法的 Markdown/HTML 模板和活动格式；
- 仅更新当前活动格式；
- 订阅偏好改变（如多窗口以后需要；本阶段可预留）；
- 返回稳定错误码及字段级 validation error。

Main 侧服务在内存中保存偏好即可。本阶段禁止把该偏好写入 API Key 配置、环境变量、会话树节点或普通日志。

### 5.3 会话运行时的 system message 注入

`DesktopConversationService.startTurn` 在验证 revision/current 后：

1. 读取当前 generation preferences；
2. 对模板长度、空白、格式和版本做 Main 侧最终校验；
3. 将模板作为 synthetic system message 传给运行时 context builder；
4. 冻结格式、模板版本与 request ID 的对应关系；
5. 正常流式执行，不让该 synthetic message 成为用户可见树节点；
6. completed 时把声明格式投影到完成 turn 的只读元数据。

手工上下文与根路径上下文都应在 synthetic system message 之后使用同一规则。失败和取消时不得留下格式元数据半成品。

### 5.4 Model Catalog Service

把现有 ProviderRuntimeService 中“拼 URL + headers + JSON 解析”的目录逻辑抽成受测试的 Model Catalog Port/Service：

- OpenAI-compatible catalog adapter：`/v1/models`、Bearer、`data[].id`；
- Anthropic-native catalog adapter：官方 Models endpoint、Anthropic 认证头、官方响应结构；
- Gemini catalog adapter：Gemini Models endpoint、Google Key、`models[].name` 标准化；
- manual-only adapter：不请求网络，明确返回可手工输入；
- local proxy profile：可指定生成协议与目录协议的组合，不能靠 provider 字符串隐式推断。

统一结果需包含 models、实际目录模式、是否可手工输入和安全的诊断摘要。结果不得含 API Key、完整 URL query、headers 或原始响应。

### 5.5 渲染模块

保留 `MessageContent` 作为唯一消息内容入口，内部拆成独立 renderer：

- Markdown renderer：GFM + 数学语法解析 + KaTeX React 输出；
- HTML renderer：DOMPurify 后的 HTML fragment；
- SVG sanitizer policy：只在 HTML renderer 内生效，显式、最小化 allowlist；
- plain-text fallback：用于未知 declared format、未完成不完整 fragment 或安全校验失败的可恢复展示。

Markdown 数学渲染和 HTML SVG 支持必须相互隔离：Markdown 不执行原始 HTML；HTML 不把 `$...$` 猜测成公式。

## 6. 输出模板规范

提供代码内置的、可编辑的基础模板。模板内容应短、明确、版本化，且不要承诺模型一定遵守。

### 6.1 Markdown 基础模板语义

- 只输出 CommonMark/GFM Markdown；
- 不输出原始 HTML 标签；
- 数学使用 `$...$`（行内）和 `$$...$$`（块级）；
- 代码使用 fenced code block；
- 不输出 SVG、script、style、iframe 或外部资源。

### 6.2 HTML 基础模板语义

- 只输出安全 HTML fragment；
- 不输出 Markdown 标记、完整 HTML 文档标签、script、style、iframe、form、外部资源或事件属性；
- 需要图形时，只在启用 SVG 支持后使用计划允许的内联 SVG 子集；
- 不将 API Key、用户隐私或工具调用结果放进 markup attribute；
- 若无法满足格式要求，输出纯文本段落而不是混合格式。

设置页须明确提示：系统提示词只能提升格式一致性，不能作为安全机制；最终安全由 renderer sanitizer 负责。

## 7. LaTeX 和 SVG 安全策略

### 7.1 Markdown LaTeX

采用成熟、纯前端的 Markdown math 插件和 KaTeX 渲染器。实施前确认依赖与 React 19、Vite、Electron CSP 兼容。

要求：

- 同时支持 `$...$`、`$$...$$`、`\\(...\\)`、`\\[...\\]` 中选定且文档化的语法；
- 解析失败时显示原始公式文本或局部错误提示，不使整条消息失败；
- KaTeX CSS 由本地 bundle 提供，不通过 CDN 注入；
- 公式输出不允许执行 JavaScript、加载网络资源或修改全局样式；
- 长公式具有溢出处理，避免撑破消息气泡。

MathJax 及需要动态脚本加载的方案不纳入本阶段。

### 7.2 HTML SVG

SVG 是高风险输入面，不能只把 `svg` 从 forbidden tags 中移除。实施时必须：

- 使用独立的 SVG sanitizer config；
- 只允许必要的几何、文本、分组和安全 presentation 元素；
- 默认禁止 `script`、`foreignObject`、`use`、动画元素、滤镜、外链 href/xlink:href、事件属性、style 和 data/javascript URL；
- 限制节点数、属性长度、viewBox 尺寸和总 SVG 文本长度；
- 只允许内联 SVG，不加载 `<img>`、外部字体、CSS 或远程资源；
- 清除或降级失败时显示原始文本提示，不渲染半净化 SVG；
- 对 DOM clobbering、事件属性、外链、畸形 XML、超大 path 和嵌套 SVG 编写安全回归测试。

不支持可执行 SVG、交互 SVG、SMIL 动画和 PDF/图片文件输入。

## 8. 本地开发测试预设

为方便本地代理调试，可提供一个仅开发模式可见的“加载本地 Anthropic 测试预设”动作：

- 启用条件为显式开发环境变量，例如 `DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET=1`；
- Provider、回环 Base URL、生成协议、目录协议和默认模型可来自代码中的无秘密 profile；
- API Key 必须来自用户的 `.env.local` 或运行进程环境，不能写进 TypeScript、README、测试快照、计划书或提交历史；
- `.env.local` 继续被 gitignore；可提供 `.env.local.example`，但只留变量名；
- 预设按钮在 production build 完全不可用；
- 载入预设后仍要求用户显式“保存配置”才替换 Main 当前执行器；
- UI 显示“仅本地开发”标识和实际目录协议，避免把本地设置误认为正式供应商能力。

## 9. 分阶段实施

### 阶段 A：Composer 与中文输入法

1. 分离草稿编辑状态、发送资格和流状态。
2. 流式时启用 textarea，保留 Stop，禁止第二次 startTurn。
3. 实现 composition event 与 Enter 防误触策略。
4. 为中英文、候选词确认、Shift+Enter、多行草稿、流中编辑、取消/失败后发送补齐组件测试。

通过条件：流式期间可输入，任何 IME 组合态 Enter 都不发送，第二个请求始终由 Main 拒绝/前端禁用。

### 阶段 B：Generation Preferences 与系统提示词

1. 定义共享 DTO、Zod schema、错误码、严格长度限制和默认模板版本。
2. 增加 Main preferences service、transport、preload bridge、Renderer port/adapter。
3. 在设置页新增“输出格式”区，提供模式选择、模板预览、编辑、恢复默认和保存状态。
4. 在会话服务创建 synthetic system message，并冻结每个 request 的偏好快照。
5. 将 declared format 投影到已完成 turn 的最小元数据。

通过条件：切换格式后下一轮请求实际收到对应 system message；当前流不受影响；用户提示、会话树原文和 API Key 均不被意外改写。

### 阶段 C：模型目录解耦与本地预设

1. 定义 catalog protocol 配置与 Main-only catalog service。
2. 为三种原生目录及 OpenAI-compatible 代理目录实现独立解析器。
3. 更新设置页，使生成协议和目录协议的差异可见、可配置。
4. 实现开发模式预设和 `.env.local.example`，不提交真实密钥。
5. 为 Anthropic generation + OpenAI catalog proxy 组合添加 HTTP mock 集成测试。

通过条件：相同代理可按不同目录模式获得准确模型列表；失败时显示已尝试的安全摘要并允许手工 model ID。

### 阶段 D：Markdown 数学与 HTML SVG

1. 接入本地 KaTeX 依赖、math parser 和 scoped CSS。
2. 实现 SVG 允许策略、限制与净化失败降级。
3. 保持 Markdown raw HTML 禁止和 HTML sanitizer 默认拒绝外部资源。
4. 用正常公式、损坏公式、复杂 SVG 与恶意 SVG 样例构建回归测试。

通过条件：公式和允许 SVG 可显示；危险结构、网络请求和脚本均被剥离；不影响普通 Markdown/HTML 消息。

### 阶段 E：端到端验证与文档

1. 使用 fake executor 验证格式模板注入、流式草稿和 tree projection。
2. 使用本地 mock HTTP 验证目录协议组合与错误脱敏。
3. 使用至少一个真实 Provider 做手工流式验收，但不记录凭据。
4. 更新 README：输入快捷键、IME 行为、输出格式、数学/SVG 限制、目录协议和本地预设启用方式。

## 10. 测试矩阵

### 10.1 Composer

- streaming 时 textarea 可编辑，Stop 可点击，Send 不会启动第二轮；
- 完成、失败、取消后草稿完整保留；
- Enter 发送、Shift+Enter 换行；
- `isComposing`、composition start/end、`keyCode 229` 都不会提交；
- 英文键盘正常提交不回归；
- 未配置 Provider、revision 冲突和 TURN_IN_PROGRESS 显示可恢复提示。

### 10.2 偏好与 system message

- 默认 Markdown/HTML 模板及恢复默认；
- DTO 拒绝未知字段、超长模板、非法格式和敏感字段；
- Renderer 无法读取 API Key；
- Main 生成的 system message 顺序正确且不进入可见会话树；
- 流中变更偏好只影响下一轮；
- 完成、失败、取消时格式元数据与请求状态一致；
- 旧 turn 缺失元数据时按安全默认方式展示。

### 10.3 Model catalog

- OpenAI-compatible、Anthropic、Gemini 官方目录的 URL、headers、分页/限制和响应解析；
- Anthropic generation + OpenAI-compatible catalog 的本地代理组合；
- 无目录能力、目录失败、超时和 malformed JSON 的稳定错误；
- 不泄露 key、header、query credential 或原始 provider response；
- 手动 model ID 始终可用；
- 开发预设仅在显式开发开关和本地变量齐全时出现。

### 10.4 Renderer 安全

- Markdown 行内与块级公式、Unicode、长公式、无效公式；
- Markdown 原始 HTML 仍不能执行；
- HTML 安全 fragment 正常显示；
- SVG 正常几何图形可显示；
- SVG 中脚本、事件属性、foreignObject、外链、动画、style、超长数据和异常节点被拒绝；
- 流式不完整公式/HTML/SVG 不导致崩溃；
- 声明格式与原文不一致时有可见、无执行的降级行为。

### 10.5 全量命令

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
git diff --check
```

本地开发窗口：

```bash
pnpm --filter chat-desktop run dev
```

## 11. 非目标与风险控制

- 不自动把任意混合格式修复为另一种格式；
- 不以系统提示词替代 HTML/SVG sanitizer；
- 不提交实际 API Key，即使其只指向 loopback 服务；
- 不为了支持 SVG 放宽 `sandbox`、`contextIsolation`、CSP、外链导航限制或 Node integration；
- 不在本阶段支持 PDF、图片上传、OCR、文件解析、Mermaid、MathJax、远程 CSS 或远程图片；
- 不实现并行 turn 或隐式消息队列；
- 不将开发预设带入 production build。

## 12. 完成标准

只有同时满足以下条件才可归档：

1. 流式期间可以安全编辑草稿，中文 IME Enter 不误发；
2. 下一轮请求仍遵守单 active turn 约束；
3. Markdown 公式与受限 HTML SVG 有安全、可测试的渲染路径；
4. 格式系统提示词可以编辑、版本化、经 Main 注入并与下一轮输出模式一致；
5. 混合输出不会跨越安全边界，且有明确降级体验；
6. Anthropic 生成与 OpenAI-compatible 目录可独立组合；
7. 开发预设不暴露或提交密钥；
8. 全量 typecheck、边界检查、测试与桌面构建通过；
9. README 说明用户可见行为、限制和测试方式。
