# 多 Provider 模型协议接入实施计划

> 适用分支：从当前 `test-cli` 创建功能分支后实施。  
> 本阶段目标：在保持“单模型、单会话、流式文本输出”不变的前提下，支持 `openai-compatible`、`anthropic`、`gemini` 三类原生协议。

## 1. 目标、边界与完成定义

### 1.1 目标

- 保持 `ChatKernel`、`ChatModelPort`、IPC 和 Renderer Client 的调用契约稳定。
- 将每个 Provider 的请求格式、认证 Header、流式事件格式收敛到 `chat-model-adapters`。
- 在 CLI 和 Electron Host 中通过同一份 `ProviderConfig` 选择一个模型 Provider。
- 支持文本 delta、正常结束、Provider 错误、网络错误、超时与取消。
- 兼容当前的 OpenAI-compatible 流程，不要求用户修改已有 `AI_API_BASE_URL`、`AI_API_KEY`、`AI_MODEL_ID` 配置。

### 1.2 本阶段非目标

- 不做多模型路由、模型切换 UI、模型列表拉取或自动 fallback。
- 不做工具调用、图片/音频输入、结构化输出、思维链展示、用量计费或持久化会话。
- 不接入 Anthropic Bedrock / Vertex AI、Gemini Vertex AI 等云平台代理；这些不属于原生 Anthropic/Gemini API。
- 不在 Renderer 或 Preload 持有 API Key。

### 1.3 完成定义

在相同的 `ChatKernel` 单测契约下，三种 Provider 均可通过 fake SSE 流完成：

```text
started → N × delta(sequence 递增) → completed
```

并且 CLI 能分别以 `text` 和 `jsonl` 输出方式运行三类协议的本地 mock 端到端测试。

## 2. 现状与关键决策

当前 `packages/chat-model-adapters` 只有 `OpenAICompatibleModelAdapter`；`ChatModelPort` 已经是正确的稳定边界：

```ts
streamChat(input, signal) => AsyncIterable<
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
>
```

因此不修改 Core 的协议，也不让 Core 识别 `anthropic` 或 `gemini`。新增 Provider 的差异只留在 Adapter 内。

本计划选择**直接使用标准 `fetch` + 自建 SSE 解码器**，暂不新增各厂商 SDK。理由是当前项目需要保持 Electron Host 和 headless CLI 的轻量、可测、统一的取消行为；SDK 引入可留作后续独立决策。

## 3. 目标架构

```mermaid
flowchart LR
  C[调用方<br/>test-cli / Electron Host] -->|start / cancel / ChatEvent| K[ChatKernel]
  CFG[ProviderConfig<br/>provider + baseUrl + apiKey + modelId] --> F[createModelAdapter]
  F --> P[ChatModelPort]
  K -->|streamChat(messages, AbortSignal)| P

  P -. implements .-> O[OpenAICompatibleAdapter]
  P -. implements .-> A[AnthropicMessagesAdapter]
  P -. implements .-> G[GeminiGenerateContentAdapter]

  O -->|POST /chat/completions<br/>Bearer + SSE| OA[OpenAI-compatible API]
  A -->|POST /v1/messages<br/>Auth + SSE named events| AA[Anthropic Messages API]
  G -->|POST :streamGenerateContent?alt=sse<br/>x-goog-api-key + SSE| GA[Gemini API]
```

架构约束：

- `chat-core` 不得 import `fetch`、Provider 名称或 Provider 请求类型。
- `apps/test-cli` 和 `apps/desktop` 只能调用 `createModelAdapter(config)`，不得自行 `new` 某个具体 Adapter。
- 三个 Adapter 只能依赖 `chat-core` 的 Port 类型和 `chat-contracts` 的消息类型；不得依赖 Electron、React、CLI 输出代码。
- 所有 Provider 流都先经共享 SSE 解码器，再由 Provider 专属 normalizer 转为 `ChatModelPort` chunk。

同时生成了可交互架构图：`MULTI_PROVIDER_MODEL_ADAPTERS.html`（由配套架构 JSON 生成）。

图中 Adapter 到各 API 的连线不重复标注 `HTTPS + SSE`，因为 Adapter 的子标签已明确该传输语义；Provider API 节点的路径补充了端点差异。

## 4. Provider 协议对照

| Provider Kind | 请求与认证 | 请求体映射 | 文本流映射 | 结束与错误 |
|---|---|---|---|---|
| `openai-compatible` | `POST {baseUrl}/chat/completions`；`Authorization: Bearer` | `model`、`messages`、`stream: true` | `choices[0].delta.content` | `finish_reason` 或 `[DONE]` |
| `anthropic` | `POST {baseUrl}/v1/messages`；`Authorization: Bearer`、`anthropic-version: 2023-06-01` | `model`、`max_tokens`、`messages`、`stream: true`；`system` 独立提取 | `event: content_block_delta` 且 `delta.type=text_delta` 的 `delta.text` | `message_stop` 完成；SSE `error` 或 HTTP 错误失败 |
| `gemini` | `POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse`；`x-goog-api-key` | `contents: [{role, parts:[{text}]}]` | `candidates[0].content.parts[*].text` | `finishReason` 完成；SSE/API error 失败 |

Anthropic 的 Messages API 使用 SSE 命名事件，流中的文本来自 `content_block_delta` / `text_delta`，最终以 `message_stop` 结束；未知事件必须忽略但不可导致流崩溃。[Anthropic 流式文档](https://platform.claude.com/docs/en/build-with-claude/streaming)

Anthropic 每次请求必须发送 `anthropic-version`；它的 Messages API 请求中还需要 `max_tokens`。[Anthropic API 概览](https://platform.claude.com/docs/en/api/overview)、[Create a Message](https://platform.claude.com/docs/en/api/messages/create)

Gemini 的 `streamGenerateContent` 是 SSE，路径为 `POST /v1beta/{model=models/*}:streamGenerateContent`，使用 `x-goog-api-key` 认证。[Gemini API Reference](https://ai.google.dev/api/generate-content)、[Gemini API 概览](https://ai.google.dev/api)

### 4.1 消息角色映射

| Core `ChatRole` | OpenAI-compatible | Anthropic | Gemini |
|---|---|---|---|
| `system` | `messages[].role = system` | 从 messages 中抽出并合并为顶层 `system` 文本块 | 暂时并入首个 user 内容，并在代码注释中标明限制 |
| `user` | `user` | `user` | `user` |
| `assistant` | `assistant` | `assistant` | `model` |

当前阶段仍是单轮 user 提示词；角色映射必须先实现并测试，为将来的多轮会话保留正确扩展点。若 Gemini 对 system instruction 的支持要在下一期启用，应新增显式 `systemInstruction` 映射，而非继续把 system 文本拼接到 user 内容。

## 5. 公开配置与命名要求

### 5.1 Provider 类型

在 `packages/chat-model-adapters/src/provider-config.ts` 定义并导出：

```ts
export const MODEL_PROVIDER_KINDS = [
  'openai-compatible',
  'anthropic',
  'gemini'
] as const

export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number]

export interface ProviderConfig {
  provider: ModelProviderKind
  baseUrl: string
  apiKey: string
  modelId: string
  maxOutputTokens: number
  anthropicVersion?: string
}

export function createModelAdapter(config: ProviderConfig): ChatModelPort
```

命名固定使用：`OpenAICompatibleModelAdapter`、`AnthropicMessagesModelAdapter`、`GeminiGenerateContentModelAdapter`、`createModelAdapter`。不得以模型名称（例如 `ClaudeAdapter`、`GeminiFlashAdapter`）命名 Adapter。

### 5.2 CLI 配置

在现有参数上新增：

| CLI 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--provider <kind>` | `AI_PROVIDER` | `openai-compatible` | 三个固定枚举值之一 |
| `--max-output-tokens <n>` | `AI_MAX_OUTPUT_TOKENS` | `1024` | Anthropic 必传；对其他 Provider 可先不发送 |
| — | `AI_ANTHROPIC_VERSION` | `2023-06-01` | 仅 Anthropic Adapter 使用 |

继续保留：`--base-url` / `AI_API_BASE_URL`、`--api-key` / `AI_API_KEY`、`--model-id` / `AI_MODEL_ID`。

规则：

- 配置优先级始终是 `CLI 参数 > 环境变量 > Provider 默认值`。
- `AI_PROVIDER` 未配置时保持 `openai-compatible`，确保既有 CLI 命令不变。
- `baseUrl` 缺失时仅允许使用安全的官方默认值：Anthropic 为 `https://api.anthropic.com`，Gemini 为 `https://generativelanguage.googleapis.com`；OpenAI-compatible 必须显式提供。
- `apiKey` 不得写入 JSONL、错误文本或诊断日志；任何 Provider 错误 body 需先脱敏和截断。
- 不能接受任意 URL 中的 key query 参数；Gemini key 必须放入 `x-goog-api-key` Header。

### 5.3 Electron Host 配置

`apps/desktop/src/main/app-config.ts` 改为复用同一套 Provider 配置解析/校验逻辑，不能与 CLI 复制两套枚举和默认值。

建议新增 `packages/chat-model-adapters/src/provider-config.schema.ts`，由 CLI 和 Host 同时调用；桌面 `.env` 使用与 CLI 相同的 `AI_*` 环境变量。

## 6. 文件级实施清单

| 路径 | 操作 | 职责 |
|---|---|---|
| `packages/chat-model-adapters/src/provider-config.ts` | 新增 | `ProviderConfig`、枚举、默认 Base URL、校验结果 |
| `packages/chat-model-adapters/src/sse.ts` | 新增 | CRLF/LF、`event:`、多行 `data:`、注释和末尾缓冲的通用 SSE 解析 |
| `packages/chat-model-adapters/src/model-adapter.factory.ts` | 新增 | Provider 分发；未知 provider 必须失败 |
| `packages/chat-model-adapters/src/openai-compatible-model.adapter.ts` | 重构 | 使用共享 SSE 解析器，保持既有协议兼容 |
| `packages/chat-model-adapters/src/anthropic-messages-model.adapter.ts` | 新增 | Messages 请求映射和 Anthropic SSE normalizer |
| `packages/chat-model-adapters/src/gemini-generate-content-model.adapter.ts` | 新增 | Gemini 请求映射和 SSE normalizer |
| `packages/chat-model-adapters/src/index.ts` | 修改 | 仅导出公共类型、工厂和 Adapter 类 |
| `apps/test-cli/src/cli-args.ts` | 修改 | `--provider`、`--max-output-tokens` 参数与帮助文本 |
| `apps/test-cli/src/cli-config.ts` | 修改 | 解析为 `ProviderConfig`；保持旧环境变量兼容 |
| `apps/test-cli/src/cli-runner.ts` | 修改 | 通过 factory 创建 Port，不直接实例化 OpenAI Adapter |
| `apps/desktop/src/main/app-config.ts` | 修改 | 复用 provider 配置解析，保留 `.env` 加载职责 |
| `apps/desktop/src/main/electron-host.ts` | 修改 | 通过 factory 创建 Port；不得 import 具体 Adapter |
| `tests/adapters/*.test.ts` | 新增/重构 | 三种协议 fixture、错误/取消/SSE 边界测试 |
| `tests/cli/*.test.ts` | 修改 | provider 参数、默认兼容与传递 factory 测试 |
| `tests/integration/provider-streams.test.ts` | 新增 | 本地 HTTP mock 对每个 Provider 的真实 `fetch` + SSE 端到端验证 |
| [`TEST_CLI_TEST_FLOW.md`](../../../TEST_CLI_TEST_FLOW.md) | 修改 | 新增三个 Provider 的执行示例 |

`apps/desktop/src/main/openai-compatible-model.adapter.ts` 若只是兼容 re-export，应删除或替换为指向共享包的 re-export；不得留下两份实现。

## 7. 错误、取消与流处理要求

### 7.1 统一错误原则

- Adapter 对非 2xx 响应创建带 `status` 的错误；仅携带经过脱敏、最大长度限制后的摘要。
- Adapter 对 `fetch` 错误保留 `cause.code` 到可被 Core 识别的字段。当前 Node `fetch` 常把 `ECONNREFUSED` / `ENOTFOUND` 放在 `error.cause.code`，必须补齐映射，避免显示为 `UNKNOWN`。
- Core 统一映射：401/403 → `PROVIDER_UNAUTHORIZED`；429 → `PROVIDER_RATE_LIMITED`；5xx、529、网络失败 → `PROVIDER_UNAVAILABLE`；Abort → `REQUEST_ABORTED`。
- Anthropic 的 SSE `event: error`、Gemini 流内 error 内容都必须终止迭代并映射为公开错误；禁止把原始响应全文输出到 CLI。

### 7.2 流与取消原则

- `AbortSignal` 必须传入每个 `fetch`，取消后 Adapter 不再 yield delta 或 finish。
- `reader.cancel()` 和 `reader.releaseLock()` 在 `finally` 中处理；不得泄漏 reader。
- `[DONE]` 只属于 OpenAI-compatible；Anthropic 用 `message_stop`；Gemini 应基于 `finishReason` 或成功流结束。
- Provider 返回未知 SSE event/type 时跳过；已知 error event 必须失败。任何正常流只能 yield 一次 finish。

## 8. 测试计划与验收矩阵

### 8.1 适配器单元测试

每个 Provider 至少覆盖：

| 场景 | OpenAI-compatible | Anthropic | Gemini |
|---|---:|---:|---:|
| 请求 URL、认证 Header、Body 映射 | 必须 | 必须 | 必须 |
| 两个文本 delta 保持顺序 | 必须 | 必须 | 必须 |
| 完成事件映射为一次 `finish` | 必须 | 必须 | 必须 |
| 分片、CRLF、末尾无换行 | 必须 | 必须 | 必须 |
| 401、429、5xx HTTP 错误 | 必须 | 必须 | 必须 |
| 流内 error 事件 | 可选（Provider 支持时） | 必须 | 必须 |
| `AbortSignal` 中断且不再输出 | 必须 | 必须 | 必须 |
| 未知 SSE event 安全忽略 | 必须 | 必须 | 必须 |

fixture 必须是仓库中的静态字符串或 `ReadableStream`，不可写入真实 Key 或真实 Provider 响应日志。

### 8.2 Factory 与配置测试

- 每个合法 `provider` 返回相应 Adapter。
- `openai-compatible` 在未提供 `AI_PROVIDER` 时仍作为默认值。
- 不支持的 `provider`、非法 URL、空 key、空 model、非正 `maxOutputTokens` 均在启动请求前失败。
- Anthropic/Gemini 未提供 base URL 时使用指定官方默认值；OpenAI-compatible 缺失 base URL 时失败。
- CLI 参数覆盖环境变量；环境变量覆盖默认值。

### 8.3 CLI 本地端到端测试

为三种协议各起一个进程内 mock HTTP server，验证：

```text
CLI args/env
  → resolveCliConfig
  → createModelAdapter
  → ChatKernel
  → Provider mock SSE
  → text / jsonl stdout
```

断言 text 输出为完整文本加换行；jsonl 只包含 `chat.stream.*` JSON；stderr 和 stdout 均不包含 API Key。

### 8.4 人工真实服务 Smoke Test

只在本地手动执行，不进入 CI：

```bash
# OpenAI-compatible（保持现有兼容方式）
AI_PROVIDER=openai-compatible \
AI_API_BASE_URL="https://your-host/v1" \
AI_API_KEY="..." \
AI_MODEL_ID="..." \
pnpm cli:test --prompt "只回复 OK" --no-color

# Anthropic 原生 API
AI_PROVIDER=anthropic \
AI_API_KEY="..." \
AI_MODEL_ID="..." \
AI_MAX_OUTPUT_TOKENS=128 \
pnpm cli:test --prompt "只回复 OK" --no-color

# Gemini 原生 API
AI_PROVIDER=gemini \
AI_API_KEY="..." \
AI_MODEL_ID="..." \
pnpm cli:test --prompt "只回复 OK" --no-color
```

## 9. Agent 拆分与执行顺序

### Agent A：共享协议与工厂

负责 `provider-config.ts`、共享 SSE 解析器、factory、公共 export，以及其单元测试。不得修改 `chat-core` 的 `ChatModelPort`。

交付条件：factory 在 fake config 下返回正确 Adapter；SSE 解析器覆盖 CRLF、多行 `data:`、named event、终端缓冲和取消。

### Agent B：Anthropic Adapter

依赖 Agent A 的 SSE/parser 接口，新增 `AnthropicMessagesModelAdapter` 与测试 fixture。

交付条件：`/v1/messages`、认证/version Header、`max_tokens`、system 提取、`content_block_delta/text_delta`、`message_stop`、SSE error 均有测试。

### Agent C：Gemini Adapter

依赖 Agent A 的 SSE/parser 接口，新增 `GeminiGenerateContentModelAdapter` 与测试 fixture。

交付条件：`streamGenerateContent?alt=sse`、`x-goog-api-key`、`contents/parts` 映射、文本提取、finish/error/abort 均有测试。

### Agent D：调用方集成与回归

在 A/B/C 完成后修改 CLI、Electron Host、架构边界脚本、测试流程文档，并添加 CLI mock 端到端测试。

交付条件：现有 OpenAI-compatible CLI 命令不变；三种 Provider 配置均能通过 CLI fake E2E；Electron Host 不再 import 具体 Adapter。

### 集成顺序

```text
A（共享抽象）
  ├─ B（Anthropic）
  └─ C（Gemini）
       ↓
     D（CLI / Electron 集成与回归）
       ↓
     负责人执行全量验收与真实 Provider smoke test
```

多人并行时，A 应先合入或提供稳定接口；B/C 不得各自实现不同版本的 SSE parser 或 `ProviderConfig`。

## 10. 最终验收命令

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build
pnpm cli:test --help
```

验收必须包含现有 OpenAI-compatible 测试的回归、Anthropic/Gemini mock 流测试、取消/超时测试、以及至少一次每种 Provider 的人工真实服务 smoke test（使用各自授权 Key，Key 不进仓库）。
