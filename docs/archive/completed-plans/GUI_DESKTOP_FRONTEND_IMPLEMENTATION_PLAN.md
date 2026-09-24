# Electron GUI 桌面应用第一阶段实施计划

## 1. 文档用途

本文用于指导后续 Agent 在现有 AI 对话内核之上搭建正式的 Electron GUI 桌面应用骨架。

本阶段只实现：

- Electron 基础窗口与正式 Renderer 的构建链路。
- 供应商配置界面。
- AI 对话主界面。
- 两个界面之间的可靠跳转。
- Main / Preload / Renderer 三层安全隔离。
- 与后端解耦的前端端口和本地演示适配器。

本阶段不把供应商配置写入真实存储，不调用模型 API，不接入 `ChatKernel`、`conversation-runtime` 或会话树，不实现真实聊天。

计划是实现约束和验收依据，不提供可直接复制的完整业务代码。实现者可以在不破坏本文边界的前提下调整小范围文件命名，但不得擅自扩大功能范围。

---

## 2. 分支策略

### 2.1 分支名称

用户提出的 `feat:gui` 不能作为 Git 分支名，因为 Git ref 不允许使用冒号。统一采用：

```text
feat/gui
```

实施前建议执行：

```bash
git status --short --branch
git switch dev
git pull --ff-only origin dev
git switch -c feat/gui
```

约束：

- 必须从 `dev` 创建 `feat/gui`。
- 不允许从 `main` 之外的旧 CLI、TUI 或实验分支继承代码。
- 不执行 `git reset --hard`、`git clean` 或其它覆盖用户工作区的命令。
- 不主动修改 `main`、`dev`、`tui`、`tui-math-render` 和 `core-v0.1.0` 的指向。
- 当前 `tui` 是分支而不是 tag。用户关于“tui 标签（分支名……”的原始要求不完整，本计划不得据此删除、重命名或强推该分支。
- 实现完成后保持改动处于 commit-ready 状态；除非用户明确授权，Agent 不提交、不合并、不推送。

### 2.2 单次提交范围

本阶段应能形成一个边界清晰的提交，建议提交主题：

```text
feat(desktop): scaffold provider settings and chat UI
```

该提交不得混入：

- 内核行为修改。
- 会话树或运行时功能修改。
- 模型适配器修改。
- TUI 代码。
- 数据库、文件持久化或系统钥匙串实现。
- 打包、签名、自动更新或发布流程。

---

## 3. 当前仓库基线

实现者必须先理解以下现状：

- `apps/desktop` 已有 Electron Main、Preload、窗口安全参数和调试聊天 IPC。
- `apps/debug-renderer` 是内核调试页面，不是正式桌面 GUI，不应直接改造成产品界面。
- `apps/desktop/src/main/electron-host.ts` 当前会在初始化阶段读取 Provider 环境变量并创建 `ChatKernel`。
- `apps/desktop/src/preload/index.ts` 当前暴露的是 `debugChatApi`。
- `packages/chat-contracts` 已定义调试聊天命令和流式事件，但本阶段不得让正式 GUI 直接依赖真实聊天调用。
- 当前 Electron 构建配置只有 Main 和 Preload，没有正式 Renderer 入口。

本阶段应保留现有调试链路，新增正式 GUI 边界。不得删除 `debug-renderer`，也不得把正式产品组件放入 `debug-renderer`。

---

## 4. 技术选型

采用通用、成熟且便于后续扩展的方案：

| 层级 | 方案 |
|---|---|
| Desktop Runtime | Electron |
| Language | TypeScript，保持 strict 模式 |
| Renderer | React 19 |
| Build | electron-vite / Vite |
| 页面路由 | React Router，使用 `HashRouter` |
| 状态管理 | React Context + `useReducer`；本阶段不引入复杂全局状态框架 |
| 样式 | 普通 CSS + CSS Variables，可使用 CSS Modules；不引入大型 UI 组件库 |
| 表单校验 | Zod 或纯前端轻量校验；安全边界仍必须在 Main 侧重新校验 |
| Test | Vitest + React Testing Library + user-event |

选择 `HashRouter` 的原因：

- 开发环境和生产 `file://` 加载路径均可工作。
- 页面跳转不会向 Electron 请求不存在的实体文件。
- 不依赖服务端 history fallback。

本阶段不使用 Next.js、SSR、浏览器路由服务器、Tailwind 专有构建链或重量级设计系统。

---

## 5. 总体架构

```text
Electron Main
  ├─ 创建并约束 BrowserWindow
  ├─ 加载正式 Renderer
  └─ 注册极小的 Desktop Shell IPC
             │
             ▼
Preload Isolation Layer
  ├─ contextBridge
  ├─ 参数复制与最小 API 暴露
  └─ 禁止直接暴露 ipcRenderer / Node API
             │
             ▼
React Renderer
  ├─ App Shell / Router
  ├─ Provider Settings Page
  ├─ Chat Page
  ├─ UI Ports
  └─ In-memory Demo Adapters
             │
             └─ 本阶段不连接 ChatKernel / Provider / Conversation Runtime
```

必须保持的依赖方向：

```text
pages -> application hooks -> UI ports <- demo adapters
                       |
                       └─ future Electron adapters（本阶段不实现业务耦合）
```

禁止以下依赖：

```text
renderer -> electron
renderer -> chat-core
renderer -> chat-model-adapters
renderer -> conversation-tree
renderer -> conversation-runtime
preload  -> React components
main     -> React state/store
```

---

## 6. 建议文件结构

正式 Renderer 推荐放在 `apps/desktop` 内，由同一套 electron-vite 配置构建：

```text
apps/desktop/
  src/
    main/
      index.ts
      electron-host.ts
      desktop-shell.transport.ts
      security/
        navigation-policy.ts
        sender-policy.ts
    preload/
      index.ts
      desktop-api.ts
    shared/
      desktop-api.contract.ts
      desktop-api.schemas.ts
    renderer/
      index.html
      src/
        main.tsx
        app.tsx
        routes.tsx
        env.d.ts
        app-shell/
          AppShell.tsx
          AppNavigation.tsx
        pages/
          ProviderSettingsPage.tsx
          ChatPage.tsx
        features/
          provider-settings/
            ProviderSettingsForm.tsx
            provider-settings.types.ts
            provider-settings.reducer.ts
          chat/
            ChatHeader.tsx
            MessageList.tsx
            MessageItem.tsx
            ChatComposer.tsx
            chat-ui.types.ts
            chat-ui.reducer.ts
        ports/
          provider-settings.port.ts
          chat-ui.port.ts
        adapters/
          in-memory-provider-settings.adapter.ts
          demo-chat-ui.adapter.ts
        components/
          Button.tsx
          Field.tsx
          StatusNotice.tsx
        styles/
          tokens.css
          global.css
          layout.css
```

测试建议：

```text
tests/desktop-renderer/
  app-navigation.test.tsx
  provider-settings-page.test.tsx
  chat-page.test.tsx
  renderer-boundaries.test.ts

tests/transport/
  desktop-shell.transport.test.ts
  preload-desktop-api.test.ts
```

文件不必逐字一致，但必须保留：页面、业务组件、端口、演示适配器、共享桥接契约和 Electron 安全策略之间的职责分离。

---

## 7. 页面范围

### 7.1 App Shell

需要一个最小应用框架：

- 顶部栏或侧边栏。
- “对话”和“供应商配置”两个明确入口。
- 当前页面激活状态。
- 主内容区域。
- 全局状态提示区域。
- “当前为 UI Preview，尚未连接内核”的固定提示。

路由建议：

```text
#/chat
#/settings/providers
```

启动默认路由建议为：

```text
#/chat
```

未知路由必须安全重定向到默认页面，不显示空白窗口。

### 7.2 供应商配置界面

界面至少包含以下字段：

| 字段 | 要求 |
|---|---|
| Provider | OpenAI-compatible、Anthropic、Gemini |
| Base URL | 文本输入，显示 provider 默认值或空值 |
| API Key | `type="password"`，可选的临时显示/隐藏按钮 |
| Model ID | 普通文本输入 |
| Max Output Tokens | 正整数输入 |
| Anthropic Version | 仅 Anthropic 时显示 |

交互要求：

- Provider 切换时只更新前端表单状态。
- 表单进行必填项、URL 和正整数校验。
- “保存”在本阶段只写入内存适配器，并明确显示“仅本次 UI 预览有效”。
- “测试连接”可以展示为 disabled 或返回明确的 `NOT_CONNECTED` 状态，不得伪造成功。
- API Key 不写入 `localStorage`、`sessionStorage`、URL、日志、错误详情或测试快照。
- 页面卸载或点击“清除”时应清空 API Key 输入状态。
- 禁止 Renderer 直接向 Base URL 发起 `fetch`。

### 7.3 AI 对话主界面

界面至少包含：

- 当前 Provider / Model 的只读摘要区域。
- 空会话状态。
- 消息列表区域。
- User 与 Assistant 两种基础消息样式。
- 多行输入框。
- 发送按钮。
- 停止按钮的占位状态。
- 请求状态和错误提示区域。

本阶段行为要求：

- 组件布局和状态转换可以操作、测试。
- 发送动作只进入 `ChatUiPort` 的 demo 实现。
- Demo 适配器只能产生明确标注的本地占位响应，例如“UI preview: backend not connected”。
- 不调用 `window.debugChatApi`。
- 不调用真实 `ChatClient`、`ChatKernel` 或 Provider Adapter。
- 不构建真实会话树或持久化聊天历史。
- 页面刷新后 demo 消息丢失是本阶段可接受行为。

### 7.4 页面跳转

必须验证：

- Chat → Provider Settings。
- Provider Settings → Chat。
- 跳转不导致窗口刷新。
- 表单非敏感草稿可以在页面切换后保留。
- API Key 是否保留必须由明确策略决定；本阶段建议页面切换时保留、应用刷新或显式清除时销毁。
- 使用键盘 Tab 可以访问导航、表单和主要按钮。

---

## 8. 前端端口与命名规范

### 8.1 UI 端口

Renderer 内定义两类端口，用于后续替换 demo 实现：

```text
ProviderSettingsPort
ChatUiPort
```

职责要求：

- `ProviderSettingsPort` 负责读取前端可见设置、校验提交结果和清除敏感草稿。
- `ChatUiPort` 负责发送、取消和订阅 UI 所需的聊天状态。
- 页面组件只能依赖端口，不直接依赖 Electron 或内核。
- Demo Adapter 和未来 Electron Adapter 必须实现相同端口。

建议采用以下动词约定：

| 类型 | 动词 |
|---|---|
| 查询 | `get` / `load` |
| 提交 | `save` / `submit` |
| 行为 | `start` / `cancel` / `clear` |
| 订阅 | `subscribe`，返回 `unsubscribe` |
| 布尔状态 | `is...` / `can...` |

返回值使用可判别联合，禁止以字符串异常作为正常控制流：

```text
{ ok: true, value: ... }
{ ok: false, error: { code, message, field? } }
```

错误码使用稳定的大写蛇形命名，例如：

```text
VALIDATION_FAILED
NOT_CONNECTED
NOT_IMPLEMENTED
UNAUTHORIZED_SENDER
INTERNAL_ERROR
```

### 8.2 Desktop Bridge

正式桥接对象统一命名：

```text
window.desktopApi
```

不得继续使用产品组件调用 `window.debugChatApi`。调试 API 可暂时保留供旧调试界面使用。

本阶段只允许暴露与桌面壳有关的最小能力，例如：

```text
desktopApi.app.getInfo()
```

如果实现者为了页面状态需要预留 Provider/Chat 方法，必须返回明确的 `NOT_CONNECTED`，不得在 Main 中连接真实内核。更推荐只定义 Renderer 端口，把业务 IPC 留到后续集成阶段。

桥接契约放在 `apps/desktop/src/shared`，Main、Preload 和 Renderer 共享类型；共享文件不得导入 Electron 运行时模块。

### 8.3 IPC 命名

本阶段实际注册的通道必须使用：

```text
desktop:<domain>:<action>
```

例如：

```text
desktop:app:get-info
```

未来保留但本阶段不注册的命名方向：

```text
desktop:provider-settings:load
desktop:provider-settings:save
desktop:provider-settings:test
desktop:chat:start
desktop:chat:cancel
desktop:chat:event
```

禁止使用模糊名称，例如 `message`、`invoke`、`data`、`config`。

---

## 9. Electron 安全要求

### 9.1 BrowserWindow

必须保持或加强以下配置：

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
webviewTag: false
```

同时要求：

- 禁止任意新窗口。
- 禁止导航至非 Renderer 自身来源。
- 开发服务器 origin 由启动配置显式传入，不能接受通配符。
- 生产环境只加载应用内已构建文件。
- Renderer 加载失败时记录经过脱敏的错误并显示安全失败页或退出，不回退到任意远程 URL。

### 9.2 Preload

Preload 必须：

- 只通过 `contextBridge.exposeInMainWorld` 暴露冻结后的窄接口。
- 不暴露 `ipcRenderer`、`send`、`invoke`、事件对象、文件系统或进程对象。
- 不允许 Renderer 自由传入 IPC channel 名。
- 对事件监听器提供解绑函数。
- 不把 `IpcRendererEvent` 传给 Renderer。
- 对进出桥接层的数据做结构复制，不传递可变 Electron 对象。

### 9.3 Main IPC

Main 必须：

- 校验 `event.senderFrame` 和允许的 origin/file URL。
- 只接受顶层主 Frame，拒绝未知 iframe。
- 对所有 Renderer 输入使用 Zod 校验；TypeScript 类型不能替代运行时校验。
- 使用固定 allowlist channel。
- 不在错误消息中返回 API Key、请求头、完整响应或本地路径。
- 注册时返回对应 unregister 函数，窗口销毁或应用退出时清理 handler。

### 9.4 Content Security Policy

生产环境应以外部 CSS 文件为主，目标 CSP：

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'none'
```

开发环境如因 Vite HMR 需要额外来源，必须生成仅限开发服务器 origin 的独立策略；不得把开发放宽项带入生产构建。

---

## 10. Electron 启动与解耦要求

现有 `ElectronHost.initialize()` 会先解析 Provider 环境变量并创建内核，这会导致未配置 API Key 时 GUI 无法打开。第一阶段 GUI 必须可以在没有模型配置的情况下启动。

建议把生命周期拆成概念上独立的两部分：

```text
Desktop Shell Initialization
Optional AI Runtime Initialization
```

本阶段只启用 Desktop Shell Initialization：

- 创建安全窗口。
- 加载正式 Renderer。
- 注册最小 desktop shell IPC。
- 不因缺失 `AI_API_KEY`、`AI_MODEL_ID` 或 `AI_API_BASE_URL` 而退出。

旧的调试聊天初始化可以保留为显式开发入口，但不能成为正式 GUI 启动前提。不得删除现有内核代码，也不得把表单值传给 `createModelAdapter`。

---

## 11. 前端编码规范

- TypeScript 禁止无理由使用 `any`。
- React 组件使用函数组件和明确 Props 类型。
- 页面组件只负责编排，字段逻辑放入 feature 目录。
- Reducer action 使用可判别联合。
- 不在 render 阶段执行异步操作或读写桥接 API。
- Effect 必须清理订阅。
- 表单字段具备 `<label>`、稳定 `id`、错误关联和键盘可用性。
- Button 明确 `type="button"` 或 `type="submit"`。
- 禁止将 API Key 放入 React DevTools 友好的全局 store、URL 或持久化 middleware。
- 不在组件中硬编码 Provider 网络请求。
- CSS 使用语义 class，不在 JSX 中堆积大段内联样式。
- 颜色、间距和字号放入 CSS Variables；本阶段只需确保清晰可用，不要求视觉品牌化。
- 所有用户可见状态都必须有 loading、empty、error 或 disabled 表达，避免无反馈按钮。

命名约定：

| 对象 | 规则 | 示例 |
|---|---|---|
| React 组件 | PascalCase | `ProviderSettingsPage` |
| Hook | `use` 前缀 | `useProviderSettings` |
| Port | `...Port` | `ChatUiPort` |
| Adapter | `...Adapter` | `DemoChatUiAdapter` |
| Reducer Action | 领域化动词 | `providerChanged` |
| IPC 常量 | UPPER_SNAKE_CASE | `DESKTOP_APP_GET_INFO` |
| CSS class | kebab-case | `.chat-composer` |

---

## 12. 状态模型要求

### 12.1 Provider Settings 状态

至少区分：

```text
pristine
editing
validating
saved-in-memory
invalid
not-connected
```

敏感字段与非敏感字段分开处理。错误对象不得包含 API Key 原值。

### 12.2 Chat UI 状态

至少区分：

```text
idle
composing
submitting-demo
demo-completed
cancelled
failed
```

这些是 UI 预览状态，不得冒充真实内核流式状态。界面必须明显标注 demo 来源。

---

## 13. 测试要求

### 13.1 Renderer 测试

至少覆盖：

1. 默认进入 Chat 页面。
2. Chat 与 Provider Settings 双向跳转。
3. 未知路由安全重定向。
4. Provider 切换后条件字段正确显示。
5. Base URL、必填项和 token 数量校验。
6. API Key 默认不可见，切换显示后可再次隐藏。
7. API Key 不出现在日志、URL 和测试快照中。
8. 保存只写入内存并显示 UI Preview 提示。
9. Chat 发送按钮经由 `ChatUiPort`，不触发网络请求。
10. Demo 回复明确标注未连接后端。
11. 键盘可以完成路由切换和表单提交。

### 13.2 Electron 隔离测试

至少覆盖：

1. BrowserWindow 安全选项保持启用。
2. `window.desktopApi` 只包含允许的方法。
3. Renderer 无法访问 `ipcRenderer`、`require`、`process`。
4. 未授权 sender 被拒绝。
5. 非主 frame 被拒绝。
6. 非法 payload 被拒绝。
7. handler 能正确 unregister。
8. 生产 CSP 不包含任意远程来源。

### 13.3 架构边界检查

扩展 `scripts/lint-boundaries.mjs` 或增加等价测试，确保：

- Renderer 不导入 Electron。
- Renderer 不导入内核和模型适配器。
- Shared contract 不导入 Electron、React 或 Node 专属模块。
- Main 不导入 Renderer 组件。

---

## 14. 验证命令

实现者应根据最终脚本名称执行并记录：

```bash
pnpm install
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
pnpm --filter chat-desktop run dev
```

人工 smoke test：

1. 不配置任何 `AI_*` 环境变量启动 Electron。
2. 确认 GUI 可以显示，不因模型配置缺失退出。
3. 从 Chat 页面进入 Provider Settings。
4. 切换三个 Provider，检查条件字段和默认值。
5. 输入测试值并保存，确认只显示内存保存提示。
6. 返回 Chat 页面。
7. 输入一条消息，确认只产生本地 demo 状态，没有真实网络请求。
8. 关闭窗口，确认无未处理异常和残留 IPC handler。

---

## 15. 明确的非目标

本阶段禁止实现：

- Provider 配置持久化。
- 系统钥匙串、加密文件或数据库。
- 模型列表发现。
- Provider 连接测试。
- 真实 API 请求。
- `ChatKernel` 集成。
- `conversation-runtime` 和会话树集成。
- 多会话管理。
- Markdown、TeX、HTML 或代码高亮渲染。
- 文件上传、图片、语音、工具调用。
- 自动更新、安装包、签名和发布。
- 完整主题系统、动画或精细视觉设计。
- 将 API Key 从 Renderer 传入真实 Main runtime。

发现上述需求时，实施者应记录到后续计划，不得顺手加入本提交。

---

## 16. 验收标准

只有同时满足以下条件才可视为完成：

- 工作发生在 `feat/gui`。
- Electron 在没有 AI 配置时可以打开正式 GUI。
- 存在 Chat 和 Provider Settings 两个独立页面。
- 两页可通过可见导航双向跳转。
- Provider 表单包含规定字段和基础校验。
- Chat 主界面具备消息区、输入区、发送/停止控件和状态区。
- 所有聊天行为明确为 demo，不会发出模型请求。
- Renderer 不可直接访问 Electron、Node 或内核模块。
- Preload 只暴露最小的 `window.desktopApi`。
- BrowserWindow 安全参数、导航限制和 CSP 有测试保护。
- API Key 不持久化、不记录、不进入 URL。
- 类型检查、边界检查、测试和构建全部通过。
- 现有 core、CLI、conversation tree/runtime 测试无回归。

---

## 17. 交付物

后续 Agent 最终应交付：

- 正式 Electron Renderer 源码。
- 两个页面及其导航。
- UI 端口和 demo adapters。
- 最小 Desktop Bridge 与安全 IPC。
- Electron Renderer 构建配置。
- Renderer 和隔离层测试。
- 必要的边界检查更新。
- README 中的 GUI 开发启动方式和“尚未连接后端”说明。
- 一份执行过的验证命令结果摘要。

交付说明必须明确：本阶段完成的是可运行的 GUI 骨架与隔离边界，不是可实际请求模型的桌面聊天客户端。

---

## 18. 阶段停止点

完成上述内容后立即停止。不要继续连接 Provider、模型列表、ChatKernel、会话树或配置持久化。

下一阶段应单独编写“Electron GUI 与会话运行时集成计划”，在审查本阶段桥接契约和安全边界后再实施。
