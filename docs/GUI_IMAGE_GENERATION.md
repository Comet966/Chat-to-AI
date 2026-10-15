# GUI 图片生成模块

## 启动与最简手动测试

在项目根目录启动 Electron（不是单独打开 Vite 网页）：

```bash
pnpm --filter chat-desktop run dev
```

1. 点击左侧「生图」图标，进入独立的图片生成页面。
2. 页面复用供应商配置中的协议、BaseURL 和 API Key。如配置不正确，点击「供应商配置」修改后返回。
3. 本地 `docs/todo.md` 的测试网关使用以下生图参数：
   - 模型：`gemini-3.1-flash-image`。
   - 生图端点：`Chat Completions · 兼容网关图片扩展`。
   - 提示词示例：`生成一张白色背景、中央是蓝色正方形的图片，不要文字。`
4. 点击「生成图片」，等待图片出现在右侧预览区域。当前是完成后返回图片，不是图片渐进流式输出。
5. 点击「保存图片 1」，在系统保存对话框选择位置；也应测试取消保存。
6. 再次生成时点击「取消生成」，应显示取消提示且可以重新发起请求。生成过程中离开页面也会取消请求。
7. 回到聊天页面，确认聊天模型与会话树没有被生图操作改变。

若网关报不支持 `/images/generations`，请检查端点选择。模型 ID 与端点不会自动猜测或偷偷回退。

## 当前范围与协议

- OpenAI-compatible：支持标准 `/images/generations` 和显式选择的 `/chat/completions` 图片扩展。
- Gemini：使用原生 GenerateContent 生图接口，不使用 OpenAI 的端点选项。
- Anthropic：没有当前适配的文生图能力，页面明确提示不支持，不伪造成功结果。
- 生图模型 ID 可独立编辑，也可获取供应商模型列表；列表不保证每个模型都支持生图。
- 支持提示词、生成状态、取消、内联图片预览与原生文件保存；单个生图请求默认最多等待 3 分钟。
- 仅保留当前页面结果与主进程最近一次成功结果；离开页面会清空页面状态，没有图片历史持久化。
- 这个独立生图模块不包含图生图、图片编辑或会话树图片节点；聊天页面的附件输入另见 [GUI 多模态输入说明](./GUI_MULTIMODAL_INPUT.md)。
- 若供应商仅返回 URL，页面只展示可复制的地址，不自动请求外链，不提供外链下载保存。

## 分层与安全边界

调用链：页面 → `ImageGenerationUiPort` → Electron renderer adapter → preload 白名单 → main transport → `DesktopImageGenerationService` → 独立 `ImageGenerationKernel` / adapter。

新增模块不依赖聊天页面内部状态、不写入会话树，也不修改当前聊天模型。

| 层 | 职责 |
| --- | --- |
| `renderer/src/pages/ImageGenerationPage.tsx` | 表单、状态、图片预览与取消操作 |
| `renderer/src/ports` / `adapters` | UI 能力接口与 Electron 桥接，实现与页面解耦 |
| `shared/image-generation.*` | 输入与响应契约、严格运行时校验 |
| `main/image-generation` | 请求生命周期、配置快照、最近结果缓存、保存权限检查 |
| `main/electron-host.ts` | 接口注册、关闭时取消、原生保存对话框与文件写入 |

- Renderer 不持有用于生图的密钥，不直接调用模型 API，也不导入 Node、Electron 或内核实现。
- 仅暴露 `generate`、`cancel`、`save` 三个能力；拒绝非主页面、外部来源与嵌套 iframe 的 IPC 调用。
- 生成入参只包含请求 ID、模型 ID、提示词及可选端点，不接受 renderer 传入密钥或配置对象。
- 保存入参只有请求 ID 与图片下标，不接受任意路径、任意图片字节或下载 URL。主进程从自身缓存取图片，并通过系统对话框选择路径。
- 保持现有 CSP 与 Electron 隔离配置，不为生图放宽网络权限。预览仅支持受校验的 PNG/JPEG/WebP/GIF 内联数据，不允许 SVG 或脚本 URL。
- 生图期间阻止修改供应商配置或清除密钥；页面退出、窗口关闭或应用退出会取消生成。
- 供应商错误与保存错误经过公共错误层处理，不展示私有响应正文或文件系统路径。

## 自动检查

```bash
pnpm test
pnpm typecheck
pnpm lint:boundaries
pnpm build:desktop
```

只跑新增 GUI 回归测试：

```bash
pnpm test tests/desktop-main/desktop-image-generation.service.test.ts tests/transport/image-generation.transport.test.ts tests/desktop-renderer/image-generation-page.test.tsx
```

覆盖生成成功与失败、配置和聊天模型独立、取消、重复请求、离页取消、图片保存及缓存所有权、外链不下载、不支持的协议、输入校验、发送方隔离、preload 响应校验与图标导航。

真实供应商的桌面调用链测试需要显式开启（会发起一次生图请求）：

```bash
AI_RUN_DESKTOP_IMAGE_LIVE_TEST=1 \
AI_PROVIDER=openai-compatible \
AI_API_BASE_URL='http://127.0.0.1:8317/v1' \
AI_API_KEY='<本地网关密钥>' \
AI_MODEL_ID='gemini-3.1-flash-image' \
AI_IMAGE_ENDPOINT=chat-completions \
pnpm test tests/integration/desktop-image-generation.live.test.ts
```

该测试使用真实模型适配器与 HTTP 请求，通过主进程服务、IPC handler、preload 校验和 renderer adapter 验证图片字节及保存回调；它不启动 Electron、不打开原生保存对话框，也不写入文件。因此不能代替前面的 GUI 手动验收。

## 本次验证记录（2026-10-11）

- 全量自动测试：445 项通过；两个显式开启的真实供应商测试在常规测试中跳过。
- 工作区类型检查、架构边界检查、桌面端构建：通过。
- 本地网关真实桌面调用链测试：通过，返回 `image/jpeg`，547,146 字节，保存回调字节与生成结果一致。
- Electron 开发进程已启动；桌面控制工具返回屏幕截取失败，本次没有完成原生窗口显示和系统保存对话框的人工验收，仍需按上述步骤手动确认。
