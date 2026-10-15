# GUI 多模态附件：本地保存与历史上下文

## 最简手动测试

本次修改了主进程、preload 与 renderer。退出旧 Electron 开发进程后启动：

```bash
pnpm build
pnpm --filter chat-desktop run dev
```

1. 在供应商配置中选择支持视觉的模型。本地网关的 `gemini-3.1-flash-image` 已验证图片输入及流式文字输出；协议支持不代表所有模型都支持附件。
2. 在聊天页点击「添加附件」选择图片，确认文件名和缩略图，也可拖入文件或粘贴剪贴板图片。发送「描述这张图片，只回复文字」。
3. 第一轮完成后，不再选择文件，发送「再仔细看原图，补充一个细节」。历史图片会随上下文再次发送，而非只把文件名发送给模型。
4. 正常退出应用，再启动。确认会话树和当前节点仍在，继续询问原图内容，不需要重新上传。
5. 从未带附件的早期节点创建一个分支，确认该分支不会继承另一个分支里的附件。手动选择上下文时，仅所选轮次的附件参与请求。
6. 检查移除草稿附件、Stop、文件单独发送、流式期间编辑下一轮草稿，以及不支持输入类型的模型报错。

仅附件输入使用默认提示词「请分析本轮附件。」。历史消息目前展示附件名，不在历史消息里自动展开原件或提供文件管理器。

## 支持范围与限制

- 图片：PNG、JPEG、WebP、GIF，支持发送前预览。
- 文档：PDF，不执行文档脚本、不新增文档解析器。
- 音频：WAV、MP3，不自动播放或录音。
- 每条消息最多 10 个附件，每个文件最多 20 MiB；一轮请求中，当前与历史附件的原始字节总量最多 50 MiB。按请求实际包含的附件计算，重复引用也计入传输大小。超限会明确拒绝，不自动丢弃历史文件。
- OpenAI-compatible / Gemini 的支持取决于具体模型和网关。Anthropic Messages 支持图片/PDF、不支持音频；当前输入的音频在 GUI 提前拒绝，历史上下文含音频时由协议适配器明确拒绝。切换模型不改变节点结构，也不会悄悄把媒体降级成文件名。
- 只处理用户主动选择、拖入或粘贴的文件，不接受任意路径读取能力，不扫描目录、不自动下载外链。
- 没有视频、录音、RAG、OCR、自动摘要或图生图。文生图页面仍是独立模块，其结果没有自动写入聊天附件仓库。

## 保存方式

借鉴 [Chatbox 的独立 blob 存储](https://github.com/chatboxai/chatbox/blob/main/src/main/store-node.ts) 和 [LibreChat 的文件处理/上下文配置分离](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/file_config)，但实现为本项目自己的存储适配器，没有移植这些项目的具体代码。

主进程使用 Electron `app.getPath('userData')` 下的 `conversation-data` 目录：

```text
conversation-data/
  state.json             会话树、节点附件引用、当前节点和历史输出格式
  blobs/
    <sha256>.bin         原始附件字节；相同内容去重
```

- 会话树的节点结构保持不变。用户节点 `content` 只追加 `[附件："diagram.png"、"notes.pdf"]` 文字摘要。
- 附件引用在旁路记录中关联 `treeId + userNodeId`，记录内容哈希、名称、MIME、类型、大小，以及图片 detail 等请求元数据；不把 Base64 或绝对路径写入树节点。
- 请求前，根据现有根路径或手动上下文解析出节点，按引用加载文件并验证大小和 SHA-256，再挂到各自的历史 user 消息上。文件内容不挂到 assistant 或合成 system 消息上。
- 保存成功的会话、附件关联、当前选中节点和各轮输出格式可跨应用重启恢复。供应商密钥不进入这个会话文件。
- 保存采用串行写入、临时文件与原子 rename，写入前校验版本。新目录权限为 `0700`，新数据文件为 `0600`，单实例锁避免两个 Electron 实例并发写同一份状态。
- 启动时检查状态 schema 和树不变量。无法读取或损坏的状态不会被重置成空文件，原数据保留并报告启动错误。
- 本地文件以原始字节保存，**没有加密**。拥有该系统用户权限的其他程序仍可读取；备份时应同时备份 `state.json` 与 `blobs/`。

此次升级前未落盘的内存会话、一次性附件无法自动恢复，需要重新上传。

## 失败、取消与恢复

- 发起模型请求前必须完成附件保存和上下文加载；存储失败不假装发送成功。
- IPC 校验/受理前拒绝会保留输入草稿和附件。已受理后供应商失败或用户取消，按既有规则移除未完成的 user 节点和附件关联；如需重试该未完成轮次的原件，需要重新选择。
- 历史文件缺失、损坏、符号链接替换会返回 `ATTACHMENT_UNAVAILABLE`，显示对应附件名，不暴露磁盘路径；不会静默跳过。可以重新上传，或手动将该轮排除在上下文之外。
- 崩溃时留下的未完成 user 叶节点在下次启动时回滚，相关引用移除，已完成分支保留。
- 删除节点/树会清理对应引用，不直接删除共享 blob，避免破坏其他分支。失败写入、取消和删除后可能留有未引用文件；本次不实现自动磁盘垃圾回收，不能把「删除节点」等同于安全删除原件。

## 分层与安全

`ChatComposer` 使用浏览器 File API 读取用户选择的文件，经 renderer Port / Adapter → preload 白名单 → main IPC 严格校验后进入现有 conversation runtime。

`conversation-runtime` 只依赖 `ConversationAttachmentStore` 抽象，不依赖 Electron、文件系统或具体协议。默认内存适配器支持同进程历史上下文；桌面端注入本地文件适配器，同时提供树仓库。CLI 未注入文件适配器时，不会因此自动获得跨进程持久化能力。

真实字节只在提交附件的请求入参和模型请求中传递。会话 snapshot、流式事件、历史 UI 状态不携带原始字节或文件系统读取句柄。未新增任意文件读取 IPC；内部 blob ID 必须为 SHA-256，读取拒绝符号链接并校验文件大小和哈希。缩略图只允许栅格图片，拒绝 SVG/HTML。CSP、`sandbox`、`contextIsolation`、密钥隔离保持不变。

## 自动检查

```bash
pnpm build
pnpm typecheck
pnpm lint:boundaries
pnpm test
```

仅运行附件回归：

```bash
pnpm test tests/desktop-main/desktop-conversation.storage.test.ts tests/conversation-runtime/conversation-runtime.multimodal.test.ts tests/desktop-renderer/chat-attachments.test.tsx tests/integration/desktop-multimodal.test.ts
```

真实供应商验证（两轮聊天，中间重建桌面服务并重新打开文件仓库；第二轮不上传附件）：

```bash
AI_RUN_DESKTOP_MULTIMODAL_LIVE_TEST=1 \
AI_PROVIDER=openai-compatible \
AI_API_BASE_URL='http://127.0.0.1:8317/v1' \
AI_API_KEY='<本地网关密钥>' \
AI_MODEL_ID='gemini-3.1-flash-image' \
pnpm test tests/integration/desktop-multimodal.test.ts
```

测试只使用内置 PNG 和临时目录，不读取任意用户文件。真实供应商测试需要显式开启，默认跳过。HTTP/SSE 集成回归检查 renderer → preload → IPC handler → main service → 磁盘存储 → API 的完整调用链，以及重启后的实际 HTTP 请求包含历史图片；它不操作真实 Electron 窗口，最终布局和原生选择器仍按手动流程确认。

2026-10-11 验证：全量离线测试 476 项通过，3 项真实供应商测试默认跳过；类型检查、架构边界检查与完整构建通过。另行开启本地网关测试，两轮图片对话（中间重新打开存储及桌面服务）通过，收到流式文字更新，第二轮无需重新上传附件。
