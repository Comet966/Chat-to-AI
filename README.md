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

## 🖥️ Electron 桌面端 GUI（第一阶段预览）

桌面端 GUI 骨架位于 `apps/desktop`，基于 Electron + React 19 + React Router (`HashRouter`) 构建。当前阶段为 **UI 预览阶段，尚未连接后端真实内核与模型 API**：

- 包含“AI 对话主界面”与“供应商配置”两个独立页面，支持无刷新双向跳转。
- 供应商配置仅保存在内存演示适配器中，API Key 不落盘、不持久化。
- 对话主界面使用本地演示适配器，返回标注为 `[UI Preview]` 的本地模拟回复，不发出真实网络请求。
- 启动不依赖任何 `AI_*` 环境变量。

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
