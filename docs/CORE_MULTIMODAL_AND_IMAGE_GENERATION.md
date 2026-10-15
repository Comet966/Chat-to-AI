# 内核多模态输入与文生图

## 本轮边界

仅扩展 `chat-contracts`、`chat-core`、`chat-model-adapters` 和相关测试。
该内核扩展阶段本身不接入 Electron IPC、GUI、TUI、CLI 参数或会话树持久化。后续 GUI 集成已提供独立生图模块和多模态聊天输入，分别见 [GUI 生图说明](./GUI_IMAGE_GENERATION.md) 与 [GUI 多模态输入说明](./GUI_MULTIMODAL_INPUT.md)。
原有 `content: string` 和文本 `AsyncIterable` / `ChatEvent` 调用保持兼容。

## 多模态输入

`StartChatCommand.messages` 的每条用户消息可增加 `attachments`。保留 `content` 为字符串；有附件时允许空文本。
附件不使用供应商私有字段，不接收本地文件路径。调用方负责读取文件并转换成 base64；内核和适配器不读取文件、不下载远程附件。

| 附件 | 字段 | 来源 |
| --- | --- | --- |
| 图片 | `type: 'image'`、`mediaType`；可选 `detail: 'auto' / 'low' / 'high'` | base64 或 HTTP(S) URL |
| PDF | `type: 'document'`、`mediaType: 'application/pdf'`；可选 `filename` | base64 或 HTTP(S) URL |
| 音频 | `type: 'audio'`、`mediaType: 'audio/wav' / 'audio/mpeg'` | base64 |

来源为 `{ type: 'base64', data: '...' }` 或 `{ type: 'url', url: 'https://...' }`。
`data` 为带必要 padding 的原始 base64，不带 `data:...` 前缀；适配器负责生成协议所需的 data URL。
图片 MIME 限定 PNG、JPEG、WebP、GIF。其他文档格式、视频、音频输出不在本轮范围。
当前附件仅允许用户消息；附件上下文可作为历史用户消息再次传入，不自动挂到会话树。

| 接入协议 | 图片 | PDF | 音频 |
| --- | --- | --- | --- |
| OpenAI-compatible Chat Completions | base64 / URL → `image_url` | base64 → `file`；拒绝 PDF URL | WAV / MP3 → `input_audio` |
| Anthropic Messages | base64 / URL → `image` | base64 / URL → `document` | 明确拒绝 |
| Gemini GenerateContent | base64 → `inlineData` | base64 → `inlineData` | base64 → `inlineData` |

Gemini 不把普通 HTTP(S) URL 冒充 Files API URI，也不会自动下载；请传入 base64。
这里描述的是协议映射，不保证供应商的任意模型都具有该能力；模型不支持时仍可能返回 HTTP 错误。

校验限制：每条消息最多 10 个附件；每个 inline 附件最多 20 MiB；一次上下文累计最多 50 MiB。
附件字节数与原有文本长度限制分别计算。拒绝非法 URL、嵌入用户名密码的 URL、错误 MIME、无效 base64、未知字段和含路径的文件名。
URL 仅作为供应商引用传递，远程内容的大小与授权由调用方和供应商负责。
请求被接受时复制输入快照，`getState()` 返回深拷贝，避免调用方修改附件影响正在执行的请求。

## 文生图接口

独立的 `ImageGenerationModelPort` 和 `ImageGenerationKernel` 不依赖聊天记录或 UI。

- `createImageGenerationAdapter(providerConfig, options?)`：建立文生图适配器。
- `new ImageGenerationKernel(adapter).generate(command, signal?)`：返回成功结果或脱敏的公开错误。
- `kernel.cancel(requestId)`：取消当前图片请求。

命令至少包含 `{ requestId, prompt }`。可选 `n`（1–4）、`size`、`quality`、`outputFormat` 是 Images API 参数。
成功结果包含 `modelId` 和 `output.images`，并可带 `output.text`。
图片为 `{ type: 'base64', mediaType, data }` 或 `{ type: 'url', url }`；内核不负责存盘、URL 下载或界面展示。
同一实例只执行一个图片请求；取消后不接受迟到的成功结果。调用方可通过 `AbortSignal.timeout(...)` 设置期限。
适配器必须响应 AbortSignal；若自定义适配器忽略取消，锁会保留至其 Promise 结束。
文生图本轮使用非流式 HTTP 返回，不伪造逐字符图片流；现有文字对话继续使用真实 SSE。
空图片列表、仅文字返回、非法图片数据或危险 URL 不作为生成成功。

### 端点选择

- OpenAI-compatible 默认 `{ endpoint: 'images' }`：`POST /v1/images/generations`，支持 base64 / URL 结果。
- 显式 `{ endpoint: 'chat-completions' }`：支持兼容网关的图片扩展，读取 `message.images[].image_url.url` 或结构化 `message.content` 中的图片。发出 `modalities: ['text', 'image']`、`stream: false`。
- 原生 Gemini：`POST /v1beta/models/{model}:generateContent`，请求 TEXT / IMAGE，解析 `inlineData`，忽略 thought-only 部分。
- Anthropic：明确报不支持文生图，不虚构端点。

兼容 chat 图片端点和原生 Gemini 仅接受单次生成，不接受 Images API 的尺寸、质量、编码参数或 `n > 1`，避免静默忽略选项。
chat 图片扩展属于兼容网关能力，不代表 OpenAI 官方 Chat Completions 所有模型都支持图像输出。
端点必须显式配置，不自动降级或重复提交可能计费的请求。

`docs/todo.md` 提供的本地 `gemini-3.1-flash-image` 必须选择 `chat-completions`：实际 `/images/generations` 返回 400 并提示不支持该模型，chat 端点返回 `message.images` 中的 JPEG data URL。
配置和密钥不硬编码到内核、测试或默认供应商中。

## 测试

离线矩阵（不消耗模型额度）：

```sh
pnpm test tests/contracts tests/core tests/adapters
pnpm typecheck
pnpm lint:boundaries
```

本地真实请求测试（会发出一次文生图和一次图片理解请求，普通 `pnpm test` 默认跳过）：

```sh
AI_RUN_MULTIMODAL_LIVE_TEST=1 \
AI_PROVIDER=openai-compatible \
AI_API_BASE_URL=http://127.0.0.1:8317/v1 \
AI_API_KEY='填写 docs/todo.md 中的本地测试 key' \
AI_MODEL_ID=gemini-3.1-flash-image \
AI_IMAGE_ENDPOINT=chat-completions \
pnpm test tests/integration/multimodal-image.live.test.ts
```

该测试通过真实内核调用生成图片，校验图片文件头，再把结果作为多模态用户附件交给聊天内核，检查流式文字事件和终态。
不打印密钥或大块 base64，不修改默认供应商，也不保存到用户会话树。

### 本地联调记录

2026-10-11，使用 `docs/todo.md` 中的本地配置和指定模型，通过真实内核烟雾测试：

- 文生图返回 JPEG，解码后 524,847 字节，JPEG 文件头校验通过。
- 将该图片作为用户附件发送给 ChatKernel，收到文字 delta 和 completed 终态。
- 图片、PDF、音频的其他协议转换由离线 mock 矩阵验证；没有宣称所有供应商和模型都已实测。

## 协议参考

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI 文件输入](https://developers.openai.com/api/docs/guides/file-inputs)
- [OpenAI Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [Anthropic Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Anthropic PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
- [Gemini GenerateContent 图片生成](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en)
