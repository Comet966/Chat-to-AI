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
