# Chat-to-AI

基于 Electron 框架构建的跨平台桌面 AI 聊天客户端。

## 🎯 项目目标

本项目旨在打造一个轻量、高效、易用的桌面 AI 对话助手：

1. **跨平台桌面体验**：基于 Electron + 现代化前端技术栈，提供一致且流畅的跨平台桌面端交互体验。
2. **多模型接入**：支持主流商业大模型（OpenAI、Anthropic Claude、Google Gemini 等）及本地模型（Ollama 等）的无缝切换与管理。
3. **对话与上下文管理**：支持多会话管理、Prompt 模板定制、历史记录检索与上下文长度控制。
4. **隐私与安全**：API Key 及所有聊天记录均保存在本地，保障用户数据隐私与自主掌控。
5. **良好扩展性**：模块化架构设计，便于后续扩展插件系统、知识库（RAG）、函数调用（Tool Use）等高级能力。

## 🛠 技术栈规划

- **Runtime / Framework**: Electron
- **Language**: TypeScript
- **Frontend**: React / Vue + Tailwind CSS
- **Packaging**: Electron Builder / Electron Forge

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
