# Chat-to-AI

基于 TypeScript 的 AI 对话内核，目标是为 Electron 桌面客户端、Linux 客户端和终端界面提供一致的对话能力。

当前稳定内核版本：`core-v0.1.0`

## 当前状态

核心对话链路已经完成，当前版本聚焦于单模型、单次请求流式输出和会话树基础能力：

- 对 OpenAI-compatible、Anthropic Messages、Google Gemini 三类流式协议提供适配器。
- 通过 `ChatKernel` 统一请求生命周期、增量事件、完成、失败和取消状态。
- 通过独立的 `conversation-tree` 管理严格无环的会话树，支持节点追加、分支、删除、路径和叶节点查询。
- 通过独立的 `conversation-runtime` 将选定节点上下文与模型请求连接起来，并在请求完成后持久化 assistant 子节点。
- 当前 CLI 交互界面只用于调试；内核不依赖 Electron、React、readline 或具体模型适配器。

## 🎯 项目目标

本项目旨在打造一个轻量、高效、易用的桌面 AI 对话助手：

1. **跨平台桌面体验**：基于 Electron + 现代化前端技术栈，提供一致且流畅的跨平台桌面端交互体验。
2. **多模型接入**：支持主流商业大模型（OpenAI、Anthropic Claude、Google Gemini 等）及本地模型（Ollama 等）的无缝切换与管理。
3. **对话与上下文管理**：支持多会话管理、Prompt 模板定制、历史记录检索与上下文长度控制。
4. **隐私与安全**：API Key 及所有聊天记录均保存在本地，保障用户数据隐私与自主掌控。
5. **良好扩展性**：模块化架构设计，便于后续扩展插件系统、知识库（RAG）、函数调用（Tool Use）等高级能力。

## 🧱 内核结构

```text
packages/chat-contracts       协议、消息和流式事件契约
packages/chat-core             模型无关的流式请求内核
packages/chat-model-adapters   OpenAI-compatible / Anthropic / Gemini 适配器
packages/conversation-tree    严格树结构与不可变快照管理
packages/conversation-runtime 会话上下文、游标和请求生命周期编排
apps/test-cli                  命令行调试入口（非生产 UI）
apps/desktop                   Electron Host / Preload / Renderer 骨架
```

`conversation-tree` 与 `conversation-runtime` 和具体 API 协议解耦；切换模型或协议不会改变会话树的数据结构。前端集成将在后续阶段通过稳定的接口和事件完成。

## 🛠 技术栈

- **Runtime / Framework**: Electron
- **Language**: TypeScript
- **Frontend**: React / Vue + Tailwind CSS
- **Packaging**: Electron Builder / Electron Forge

## 快速开始

安装依赖：

```bash
pnpm install
```

运行完整检查：

```bash
pnpm typecheck
pnpm build
pnpm lint:boundaries
pnpm test
```

## 🖥️ Electron 桌面端 GUI

桌面端位于 `apps/desktop`，基于 Electron + React 19 + React Router (`HashRouter`) 构建，采用分层 Port / Adapter 架构，具备以下能力：

- **输入体验优化**：
  - **流式草稿编辑**：当 Assistant 正在流式输出时，输入框不再被禁用，用户可实时编辑下一条问题草稿；提供非阻塞提示，流式期间回车不会误发第二条请求，Stop 按钮保持可用；当前请求结束（完成、取消或失败）后草稿完整保留并可立即发送；
  - **中文输入法 (IME) 防误触**：严格监听 `compositionstart` / `compositionend` 与 `keyCode === 229`，中文/日文/韩文输入法选词按 Enter 确认候选词时绝不误发送消息；`Shift+Enter` 正常换行。
- **输出约束与格式系统提示词 (Generation Preferences)**：
  - 支持在设置页独立配置 Markdown 与 HTML 的系统提示词模板，引导模型按选定格式严谨输出；
  - 提示词作为合成系统消息 (Synthetic System Message) 在 Main Process 请求前注入，不作为独立节点污染会话树；
  - 切换渲染模式自动同步下一轮生成的输出约束偏好，历史消息记录对应的只读 `declaredOutputFormat` 格式元数据。
- **富文本与双渲染增强**：
  - **LaTeX 数学公式**：Markdown 模式支持 KaTeX 解析行内公式 (`$...$`) 与块级公式 (`$$...$$`)，公式溢出横向平滑滚动，语法异常时优雅降级而不崩溃；
  - **安全 HTML 组件**：HTML 模式支持标题、列表、表格、代码块、`figure/figcaption`、`details/summary`、`progress` 与 `meter` 等静态语义组件；
  - **安全内联 SVG**：支持同一回复中的多个静态 `<svg>`，以及 `path`, `rect`, `circle`, `text`, `linearGradient`, `clipPath`, `mask`, `marker` 等常用图形能力；
  - **隔离交互预览**：模型生成的 JavaScript 永不进入主对话 DOM；包含交互逻辑时可展开查看源码，并由用户手动启动无同源权限、无网络、无 Electron/Node 能力的 sandbox iframe，可随时停止；
  - **强安全防护**：主渲染层集中移除 `script`, `style`, `foreignObject`, `use`, `animate`, `iframe`, `form`、自定义可执行组件、外部资源与内联事件；隔离预览继续禁止网络、导航、弹窗、存储、Worker、外部媒体与设备权限；
  - 用户输入严格保持纯文本安全显示。
- **供应商目录协议解耦与本地预设**：
  - **生成与目录协议分离**：支持将 Anthropic Messages 生成协议与 OpenAI-compatible (`/v1/models`) 目录协议独立组合，适配各类本地反向代理与网关；支持 `manual-only` 纯手动输入模式；
  - **本地开发测试预设**：未打包的 Electron 默认使用 OpenAI-compatible 回环网关 `http://127.0.0.1:8317/v1` 和测试 Key `1145141919810`；设置页可手动重新载入预设。默认模型暂用 `gpt-4o`，若网关不提供此模型，请先在设置页获取模型列表并选择可用项。可通过 `.env.local` 中的 `LOCAL_OPENAI_*` 覆盖，或设置 `DESKTOP_ENABLE_LOCAL_PROVIDER_PRESET=0` 关闭；打包版不内置该预设（参考 `.env.local.example`）。
- **安全与边界规范**：
  - 严格开启 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；
  - 渲染层禁止导入任何 Electron、Node.js 原生模块或模型适配器内核。

启动桌面端开发模式：

```bash
pnpm --filter chat-desktop run dev
```

构建桌面端（Main / Preload / Renderer）：

```bash
pnpm build:desktop
```

启动交互式会话调试 CLI：

```bash
AI_API_KEY='<你的密钥>' \\
AI_API_BASE_URL='<服务地址>' \\
AI_MODEL_ID='<模型名>' \\
pnpm cli:session --provider openai-compatible --show-tree --no-color
```

进入 CLI 后可使用普通文本发送消息，以及 `/tree`、`/current`、`/select <nodeId>`、`/path`、`/branches`、`/leaves`、`/cancel` 和 `/quit` 等调试命令。三种协议的配置和人工 smoke test 见 [TEST_CLI_TEST_FLOW.md](./TEST_CLI_TEST_FLOW.md)。

## ✅ 已验证的命令行流式协议

当前项目仍处于单模型、单会话阶段，`test-cli` 已完成以下三类协议的流式集成测试：

| Provider | CLI Provider 值 | 已验证内容 |
|---|---|---|
| OpenAI-compatible | `openai-compatible` | `POST /chat/completions`、Bearer 鉴权、SSE delta、`[DONE]` 结束 |
| Anthropic Messages | `anthropic` | `POST /v1/messages`、`anthropic-version`、命名 SSE 事件、`text_delta`、`message_stop` |
| Gemini Generate Content | `gemini` | `streamGenerateContent`、`x-goog-api-key`、SSE 文本片段、`finishReason` |

测试通过进程内 mock HTTP/SSE 服务覆盖文本输出和 JSONL 输出，并验证 API Key 不会出现在 stdout 或 stderr。运行命令：

```bash
pnpm exec vitest run tests/integration/provider-streams.test.ts
```

该测试不访问真实 Provider，也不会使用真实 API Key。完整 CLI 参数、三种 Provider 的人工 smoke test 示例和验收标准见 [TEST_CLI_TEST_FLOW.md](./TEST_CLI_TEST_FLOW.md)。

## 🗺️ 后续规划

### Linux 客户端

基于当前内核制作 Linux 版本客户端，优先验证 Linux 下的配置管理、流式输出、会话树持久化和打包发布，再将成熟能力回接 Electron 桌面端。

### TUI

制作简单的终端用户界面（TUI）作为轻量客户端和内核验收工具，计划包括：

- 消息流式显示和请求取消。
- 当前节点、路径和分支的可视化浏览。
- 模型、协议和会话节点切换。
- Linux 环境下的安装与发布流程。

TUI 将通过 `conversation-runtime` 的公开接口接入，不直接依赖具体模型适配器或会话树内部实现。
