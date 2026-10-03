# GUI Claude 风格视觉改造实施计划

> 状态：已完成并归档（2026-10-03）
>
> 适用分支：`feat/gui-runtime-integration` 的后续 UI 专用分支
>
> 范围：只调整 Electron Renderer 的视觉语言、布局细节与组件表现，不修改内核、IPC 协议或会话树语义

> 完成记录：Claude-inspired 暖色设计 Token、应用骨架、对话区、供应商设置页和 React Flow 会话树视觉均已落地；真实测试树、连续问答轮次编号、完整测试矩阵与 Electron 实机检查均已完成。

## 1. 目标与边界

本阶段把现有深蓝色工程原型改造成接近 Claude Web 与 Claude Desktop 的温暖、克制、内容优先的桌面界面。这里的“接近”指借鉴颜色关系、留白、层级和交互质感，不复制 Claude 标志、文字资产、插画、专有字体或品牌图形。

改造后必须保留现有能力：

1. 左侧图标导航在对话页和供应商配置页之间跳转。
2. 左侧会话树使用 React Flow，节点不可拖动，画布可以平移和缩放。
3. 当前节点、根路径继承、自由选择继承、普通选择和临时高亮仍可明确区分。
4. 对话发送、流式输出、取消、供应商配置和模型列表行为不变。
5. Renderer 与 Main/Preload 的端口边界不变。
6. 本次默认实现浅色主题；不得顺带实现主题切换、持久化或新的业务功能。

## 2. 设计依据

执行 Agent 应以官方页面的整体气质为参考，而不是逐像素复刻：

- [Claude Desktop 官方下载页](https://claude.com/download)：确认桌面产品语境和 Claude 当前品牌呈现。
- [Claude Desktop 导航教程](https://academy.claude.com/tutorials/navigating-the-claude-desktop-app)：确认 Desktop 的功能层级和内容优先方向。
- [Claude Academy 品牌指南教程](https://academy.claude.com/use-cases/package-your-brand-guidelines-in-a-skill)：官方材料明确将 `#D97757` 作为主要橙色强调色。

视觉关键词固定为：暖白画布、暖灰分层、陶土橙强调、深炭文字、低对比边框、宽松留白、少量柔和阴影。禁止重新引入蓝紫渐变、纯黑大面积背景、霓虹描边或玻璃拟态。

## 3. 颜色与设计 Token

先重构 `styles/tokens.css`，其他样式文件只消费语义 Token，不直接散落品牌色十六进制值。

### 3.1 基础色板

| 语义 | 建议值 | 主要用途 |
|---|---:|---|
| App canvas | `#FAF9F5` | 对话主背景、设置页底色 |
| Sidebar | `#F0EEE6` | 图标栏、会话树侧栏 |
| Raised surface | `#FFFFFF` | 输入框、弹窗、浮层 |
| Soft surface | `#F5F4ED` | Hover、Assistant 次级块、工具区 |
| Border | `#E8E6DC` | 分隔线和默认描边 |
| Border strong | `#D1CFC5` | 输入框、选中控件 |
| Primary text | `#141413` | 标题和正文 |
| Secondary text | `#5E5D59` | 说明和元数据 |
| Muted text | `#87867F` | 占位、禁用内容 |
| Accent clay | `#D97757` | 主按钮、当前节点和关键状态 |
| Accent hover | `#C96442` | 主按钮 Hover/Pressed |
| Success olive | `#788C5D` | 继承节点与成功提示 |
| Info blue | `#6A9BCC` | 非主操作的信息状态 |
| Danger | `#B84A3A` | 删除、错误、停止 |

状态色必须同时依赖形状、图标、文字或描边差异，不能仅靠颜色传递。

### 3.2 排版、圆角和阴影

- 正文与控件使用本地系统 Sans 字体栈；不得加载远程字体。
- 仅空状态标题、欢迎语等少量展示性文案可以使用 `ui-serif, Georgia, serif`，业务标题和表单仍使用 Sans。
- 正文基准字号保持 14–16px，元数据不低于 12px。
- 主容器圆角建议 14–18px；小按钮和标签 8–10px；圆形树节点保持真正圆形。
- 阴影只用于输入卡、弹窗和悬浮提示，使用暖色低透明度阴影；静态页面分区优先用底色和边框。
- 动效控制在 120–220ms，并尊重 `prefers-reduced-motion`。

## 4. 页面布局方案

### 4.1 应用骨架

保持三列关系：图标栏、会话树、对话区。

```text
┌──────┬────────────────────────┬──────────────────────────────────┐
│ 图标 │ 会话树                  │ 对话                             │
│ 导航 │ 工具 / 继承模式         │ 标题与模型状态                   │
│      │ 固定节点拓扑            │ 消息流                           │
│      │                        │ 浮起的输入卡                     │
└──────┴────────────────────────┴──────────────────────────────────┘
```

- 图标栏采用较深一层的暖灰，与会话树之间用细边框分隔。
- 会话树宽度保持能容纳现有工具栏；不为了视觉改造改变节点布局算法。
- 对话主区使用暖白大画布，消息正文区域设置合理最大宽度，避免在宽屏上铺满。
- 顶部栏减少厚重矩形边界，通过留白、细分隔线和低对比文字建立层级。
- Preview 提示改为低干扰的暖色状态条，但必须保留 `role="status"` 和现有语义文案。

### 4.2 对话区

- Assistant 消息接近无气泡的文档排版：左对齐、透明或画布同色背景，靠内容间距区分轮次。
- User 消息使用柔和暖灰或浅米色气泡，不使用整块高饱和橙底。
- 角色、模型、流式状态做成弱化的元信息，不抢正文层级。
- 输入区改为悬浮卡片：白色或极浅暖色表面、清晰边框、柔和阴影、较大圆角。
- 发送按钮使用陶土橙；停止按钮使用危险色，但尺寸与位置稳定，避免流式期间布局跳动。
- 保留 Enter 发送和 Shift+Enter 换行，焦点环必须可见。

### 4.3 会话树

- 画布改成暖白/暖灰背景，网格点降低对比度。
- 普通节点：浅表面、暖灰描边、深色轮次号。
- 当前节点：陶土橙实心或强描边，并增加非颜色标识，例如内圈或小圆点。
- 根到当前路径：陶土橙或其低饱和变体。
- 自由继承节点：橄榄绿描边；与当前节点重合时仍以当前节点为主，辅以内圈表达继承。
- 普通选择：炭色外环；临时高亮：使用暖黄色光圈。不得让五种状态产生相同样式。
- 边继续使用现有自然曲线；默认边为暖灰，当前路径边使用陶土橙。箭头应轻量，避免视觉噪声。
- Hover 详情卡采用白色浮层并控制最大高度；长答案可以截断或滚动，不能覆盖整个会话树。
- React Flow 的节点位置继续由 Dagre 决定，禁止开启节点拖拽或连线编辑。

### 4.4 供应商设置页

- 页面改为单列、窄内容宽度，顶部有清晰标题和简短说明。
- 配置字段分成“供应商”“连接”“模型”三个视觉组，但不改变提交 DTO。
- 输入框、Select、按钮统一 Token、焦点环和禁用样式。
- API Key 始终保持密码输入和只返回 `hasApiKey` 的安全策略；视觉改造不得让 Renderer 缓存或展示已有密钥。
- 保存结果、模型拉取状态和错误使用一致的内联状态组件。

## 5. 组件和文件改造范围

优先修改：

- `styles/tokens.css`：建立完整的暖色语义 Token。
- `styles/global.css`：全局字体、背景、滚动条、焦点和 reduced-motion。
- `styles/layout.css`：应用骨架、导航、对话、设置页、消息和输入卡。
- `styles/conversation-tree.css`：画布、节点状态、边、工具栏和 Tooltip。
- `components/Button.tsx`、`Field.tsx`、`StatusNotice.tsx`：只在现有变体不足时补充视觉类，不改变调用协议。
- `features/chat/*`、`features/session-tree/*`：只做必要的结构 class 或可访问状态标记，避免重写业务逻辑。

以下文件原则上不得修改：

- `src/main/**`
- `src/preload/**`
- `src/shared/**`
- `packages/conversation-*`
- 供应商适配器和模型请求实现

如果视觉需求确实要求修改 JSX，必须保持 Port 入参、IPC DTO、Reducer Action 和测试 ID 稳定。

## 6. 开发与提交顺序

建议从当前集成分支新建：

```text
feat/gui-claude-visual-refresh
```

实施前先运行 `git status --short --branch`，不得覆盖用户未提交改动。按以下顺序执行并分开提交：

1. `refactor(desktop-ui): introduce warm semantic design tokens`
2. `style(desktop-ui): refresh shell chat and settings surfaces`
3. `style(desktop-ui): refresh conversation tree states`
4. `test(desktop-ui): update visual state regressions`

不要在本阶段合并分支、推送远程或归档本计划，除非用户另行要求。

## 7. 测试与验收

### 7.1 自动测试

必须通过：

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm test
pnpm build:desktop
```

现有测试不得通过删除断言、移除可访问名称或大范围更新快照来“适配”样式。若新增 DOM 包装，应优先维持角色、标签和测试 ID。

### 7.2 人工视觉验收

使用仓库内的会话树视觉检查数据启动：

```bash
VITE_DESKTOP_VISUAL_REVIEW=conversation-tree pnpm --filter chat-desktop run dev
```

至少检查：

- 1280×800 和 1440×900 下三栏不溢出。
- 14 个测试节点能完整 fit view，并能平移、缩放和定位当前节点。
- 三处分支、曲线、当前路径、普通节点和当前节点容易区分。
- 切换到自由继承后，继承高亮与选择状态可以同时辨认。
- 悬停任一节点能看到问题、答案和供应商/模型。
- 对话长文本可滚动，输入卡始终可用。
- 设置页、错误提示、加载、禁用和无数据状态均符合新色板。
- 键盘 Tab 顺序、Enter/Space 激活与焦点环可见。
- 200% 缩放下按钮和文字不互相遮挡。

## 8. 明确不做

- 不复制 Claude Logo、字标、插画或专有字体。
- 不增加在线字体、远程 CSS、第三方追踪或运行时网络资源。
- 不新增深色主题、自动主题检测或主题持久化。
- 不改变 React Flow/Dagre 技术选型和拓扑算法。
- 不修改会话树节点含义、上下文选择规则或 IPC Channel。
- 不实现 Markdown、TeX、附件、代码块工具栏或会话持久化。
- 不以视觉改造为由调整 API Key 安全策略。

## 9. 完成定义

只有同时满足以下条件才算完成：

1. 默认界面已统一为暖白、暖灰、陶土橙的 Claude-inspired 视觉系统。
2. 对话、会话树和供应商页共享同一套语义 Token。
3. 所有树节点状态清晰、曲线正确、节点不可拖动。
4. Electron 隔离层、Port 和领域行为没有被样式改造破坏。
5. 自动测试与构建全部通过。
6. 使用视觉检查 fixture 完成人工验收，并保留发现的问题清单。
