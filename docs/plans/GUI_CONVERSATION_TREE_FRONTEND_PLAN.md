# GUI 会话树前端界面实施计划

## 1. 文档用途

本文用于指导后续 Agent 在现有 Electron GUI 中实现可交互的会话树拓扑界面。

本阶段只实现 Renderer 前端、前端端口和本地 Demo Adapter，不接入 Electron IPC，不调用 `conversation-tree`、`conversation-runtime` 或真实聊天内核。实现完成后，应当可以用本地演示数据验证会话树的展示、当前节点、单选、多选、新增和删除等界面行为，同时为后续接入内核保留稳定边界。

本文是实现约束和验收依据，不提供可直接复制的具体业务代码。实现者可以小范围调整文件名，但不得破坏本文规定的依赖方向、状态边界和安全要求。

---

## 2. 技术选型结论

### 2.1 采用方案

本阶段采用：

| 能力 | 选型 | 用途 |
|---|---|---|
| 拓扑画布 | `@xyflow/react` 12.x | 节点、边、缩放、平移、框选、多选、键盘交互和自定义节点 |
| 自动布局 | `@dagrejs/dagre` 3.x | 将严格树结构计算为从上到下的层级布局 |
| UI 状态 | React Context / reducer / hooks | 管理加载、选择、弹窗、操作状态和错误 |
| 后端边界 | Renderer Port + Demo Adapter | 本阶段模拟数据，后续替换为 Electron Adapter |
| 测试 | Vitest + React Testing Library | 验证状态、交互、映射、边界和回归 |

依赖应仅安装到 `apps/desktop`。遵循当前仓库的精确版本策略，执行时先验证并锁定兼容版本；调研时可用版本为：

- `@xyflow/react` 12.11.6。
- `@dagrejs/dagre` 3.1.1。

两者均为 MIT License。实现者应保留 lockfile 变更，并在项目已有第三方许可清单存在时补充记录。

### 2.2 选择理由

`@xyflow/react` 符合本项目后续需求：

- 支持单选、修饰键多选和框选。
- 支持受控节点与受控边，应用可以拥有真正的状态所有权。
- 支持自定义节点和自定义边。
- 支持删除前拦截、键盘快捷键、缩放和平移。
- 图形库只负责交互和绘制，可以与领域数据、Electron Bridge 和内核保持隔离。
- 当前包声明 React 与 React DOM 的 peer dependency 为 `>=17`，可以与项目的 React 19 配合，但仍必须执行本计划规定的兼容性门禁。

`@dagrejs/dagre` 适合有向树布局，并能处理有明确节点尺寸的层级图。它只负责计算坐标，不拥有业务数据。

### 2.3 未采用方案

| 方案 | 不采用原因 |
|---|---|
| React Arborist | 更适合文件树或缩进列表，不是节点—边拓扑图 |
| React Complex Tree | 受控状态和多选能力较好，但主要表现为可访问树列表，不符合拓扑展示目标 |
| Cytoscape.js | 图分析和复杂网络能力很强，但本项目是严格树，集成和样式成本偏高 |
| ELK.js | 功能强但配置和异步布局复杂度超过当前需求 |
| 完全自绘 SVG | 可控性高，但需要自行实现平移、缩放、框选、多选、焦点管理和大量边界行为，风险较高 |
| 仅使用 D3 | D3 可完成布局与交互，但需要维护更多底层 DOM/事件代码，不利于 React 组件测试和后续操作扩展 |

### 2.4 资料依据

- React Flow 对节点、边、框选和多选的说明：<https://reactflow.dev/learn/concepts/terms-and-definitions>
- React Flow 受控交互与删除说明：<https://reactflow.dev/learn/concepts/adding-interactivity>
- React Flow 自定义节点：<https://reactflow.dev/learn/customization/custom-nodes>
- React Flow 布局方案比较：<https://reactflow.dev/learn/layouting/layouting>
- React Flow Dagre 示例：<https://reactflow.dev/examples/layout/dagre>
- React Flow 包信息与许可证：<https://github.com/xyflow/xyflow/blob/main/packages/react/package.json>
- Dagre 仓库与许可证：<https://github.com/dagrejs/dagre>

---

## 3. 分支和提交范围

执行 Agent 应从最新 `dev` 创建：

```text
feat/gui-conversation-tree
```

建议步骤：

```bash
git status --short --branch
git switch dev
git pull --ff-only origin dev
git switch -c feat/gui-conversation-tree
```

如果工作区存在用户改动，禁止覆盖、丢弃或带入无关提交。当前已知 `docs/todo.md` 可能包含用户改动，实施者必须保留。

本阶段应形成一个边界清晰的提交，建议主题：

```text
feat(desktop): add interactive conversation tree UI
```

除非用户明确授权，执行 Agent 不提交、不合并、不推送，也不归档本计划书。

---

## 4. 本阶段范围

### 4.1 必须实现

1. 使用演示会话数据渲染真正的树形拓扑，而不是静态占位文字。
2. 每个节点以自定义节点卡片显示基础对话信息。
3. 显示父子边和分支结构。
4. 显示当前会话节点，并高亮从根节点到当前节点的路径。
5. 支持单选节点。
6. 支持 `Cmd/Ctrl + 点击` 多选。
7. 支持框选多个节点。
8. 提供“设为当前节点”“新增子节点/分支”“删除所选节点”操作入口。
9. 所有操作通过 `ConversationTreeUiPort`，不得由图形组件直接改业务数据。
10. 提供本地 Demo Adapter，使新增、删除和切换当前节点可以在 UI Preview 中验证。
11. 提供加载、空树、错误、操作中和只读/禁用状态。
12. 保留当前对话页面和供应商页面的既有行为。
13. 增加覆盖映射、布局、交互和架构边界的测试。

### 4.2 明确不实现

- 不新增真实 Electron IPC channel。
- 不调用 `ConversationTreeService`、`ConversationRuntimeService` 或 Repository。
- 不修改内核的数据结构和树不变量。
- 不将 Demo 数据写入文件、数据库或浏览器存储。
- 不把会话树操作与真实聊天发送流程耦合。
- 不实现跨会话树拖放。
- 不允许用户通过拖拽连线创建父子关系。
- 不允许自由拖动节点后保存坐标。
- 不实现节点重排、合并、复制粘贴、撤销/重做或协作编辑。
- 不实现跨树批量删除。
- 不在节点中完整渲染 Markdown、HTML、TeX 或超长对话内容。
- 不加载任何远程字体、脚本、样式或图标资源。

---

## 5. 核心架构原则

### 5.1 依赖方向

必须保持：

```text
SessionTreePanel
  └─ ConversationTreeController / hooks
       ├─ ConversationTreeUiPort
       │    └─ DemoConversationTreeUiAdapter（本阶段）
       │         └─ Future ElectronConversationTreeAdapter（后续阶段）
       └─ Flow Presentation Adapter
            ├─ @xyflow/react
            └─ @dagrejs/dagre
```

严禁：

```text
Renderer -> Electron
Renderer -> chat-conversation-tree
Renderer -> chat-conversation-runtime
Renderer Port -> @xyflow/react
Renderer Port -> @dagrejs/dagre
Core / Runtime -> React Flow types
Custom Node -> Demo Adapter
React Flow event -> 直接修改领域快照
```

### 5.2 状态所有权

状态分为三类，不能混用：

1. **树数据状态**：节点、父子关系、版本、当前节点。由 `ConversationTreeUiPort` 提供，是业务数据来源。
2. **界面选择状态**：当前选中的一个或多个节点。由 Renderer 本地维护，不代表会话上下文已经切换。
3. **画布状态**：缩放、平移、框选过程。由 React Flow 管理或通过其受控能力管理，仅属于显示层。

React Flow 的 `nodes` 和 `edges` 是派生展示模型，不得成为会话树的事实来源。

### 5.3 当前节点与选中节点必须分离

- “当前节点”代表未来聊天上下文的游标，只允许一个。
- “选中节点”是临时 UI 状态，可以为零个、一个或多个。
- 点击节点只改变选择状态，不应静默切换当前会话上下文。
- 只有用户明确执行“设为当前节点”时，才调用 Port 的切换意图。
- 当前节点使用稳定、独立的视觉标记；不能只依靠 React Flow 的 selected 样式。
- 当前路径上的节点和边应有次级高亮，以表达根节点到当前节点的上下文路径。

---

## 6. 前端数据边界

### 6.1 UI 快照

Renderer Port 返回的快照应表达以下概念：

- tree ID。
- snapshot/revision/version。
- root node ID。
- current node ID。
- 有序节点集合。
- 每个节点的 ID、parent ID、role、内容、sequence、创建时间。
- 可选的 provider/model 来源信息。

可以为节点计算内容摘要，但摘要属于 Renderer 映射逻辑，不应覆盖原始内容。

UI 快照不得包含：

- React Flow 的坐标、Node、Edge 或 viewport 类型。
- Electron 事件对象。
- IPC channel 名称。
- Repository、Service 或 Runtime 实例。
- API Key、Base URL 或请求头。

### 6.2 `ConversationTreeUiPort`

端口应表达能力，而不是具体传输方式。至少预留：

- 加载当前树快照。
- 订阅树快照变化并返回解除订阅函数。
- 请求切换当前节点。
- 请求在指定父节点后新增子节点。
- 请求从指定节点生成分支。
- 请求删除一个或多个节点，并携带明确删除模式。
- 重新加载或刷新快照。

统一要求：

- 异步操作返回可判别结果，不使用字符串异常表示正常失败。
- 错误包含稳定 error code、用户可显示消息和可选关联节点 ID。
- 错误中不得包含敏感配置、完整请求、堆栈或本地路径。
- Port 不暴露 React Flow 类型。
- Demo Adapter 和未来 Electron Adapter 必须实现相同端口。

### 6.3 Demo Adapter

Demo Adapter 用固定、可重复的数据初始化一棵至少包含以下情况的树：

- 单一根节点。
- 一条主路径。
- 至少一个具有两个子分支的分叉点。
- 至少一个由不同 provider/model 生成的 Assistant 节点。
- 明确的 current node。

Demo Adapter 应模拟：

- 快照读取。
- 快照订阅。
- 当前节点切换。
- 增加子节点和形成分支。
- 删除叶节点或子树。
- 短暂操作中状态。
- 可测试的失败返回。

Demo 操作只存在于当前进程内存中，刷新页面后丢失。界面必须继续显示 `UI Preview`，不得让用户误认为数据已持久化。

---

## 7. 树不变量与防御性验证

虽然本阶段只使用 Demo 数据，Renderer 映射器仍应在渲染前验证基本不变量：

- 节点 ID 唯一。
- 恰好一个根节点。
- `rootId` 指向实际根节点。
- 根节点的 `parentId` 为 `null`。
- 非根节点的 parent 必须存在。
- 每个非根节点只有一个父节点。
- 不允许自引用。
- 不允许环。
- 所有节点都可从根节点到达。
- `currentNodeId` 必须存在。
- sequence 应可用于稳定排序；异常时不得静默改变业务顺序。

验证失败时：

- 不渲染部分错误拓扑。
- 显示安全错误状态。
- 保留重试入口。
- 错误信息只包含必要标识，不输出节点完整内容。

本层验证是显示层防御，不替代内核的 `TreeInvariantGuard`。

---

## 8. React Flow 展示适配层

### 8.1 适配职责

单独建立纯映射/布局模块，负责：

- 将 UI 节点映射为 React Flow 节点。
- 根据 `parentId` 生成唯一、稳定的边 ID。
- 使用 Dagre 计算节点坐标。
- 计算当前节点的祖先路径和需要高亮的边。
- 将 UI 选择 ID 映射为 React Flow selected 状态。
- 将 React Flow 选择事件转换为普通 node ID 集合。

不得在适配层调用 Port 或修改 Demo Adapter。

### 8.2 图形交互限制

为保护严格树语义，初始配置要求：

- 节点可选择。
- 节点不可自由连接。
- 不显示用于手工连线的 Handle，或将其设置为不可连接。
- 节点位置不持久化。
- 默认关闭节点自由拖动；如果为了观察临时开放拖动，也不得写回业务快照。
- 边不可选择，除非后续需求明确要求边操作。
- 禁用 React Flow 默认 Backspace/Delete 直接删除元素。
- 删除键应转化为应用级删除意图并进入确认流程。
- 禁止通过 `onConnect` 直接创建边。
- 禁止把 React Flow 的 `applyNodeChanges` 结果当成业务节点集合。

### 8.3 布局策略

初始布局采用自上而下：

```text
root
  ↓
user
  ↓
assistant
  ├─ branch A
  └─ branch B
```

要求：

- 节点使用稳定的预设尺寸，避免内容长度改变布局。
- 长内容在节点卡片中截断，不改变节点高度。
- 同级节点按 sequence 稳定排序。
- 拓扑发生变化时重新计算布局。
- 仅选择状态变化时不得重新计算布局。
- 流式文本内容变化时不得持续触发布局抖动。
- 首次加载可以自动 `fitView`。
- 选择节点、切换当前节点后不应强制重置用户的缩放和平移。
- 提供显式“适应画布/回到当前节点”的控制入口。

如果后续验证发现不同尺寸节点是刚需，再评估 Dagre 的动态尺寸能力；本阶段不要引入 ELK。

---

## 9. 界面设计

### 9.1 `SessionTreePanel`

现有占位组件改为会话树容器，至少包含：

```text
SessionTreePanel
├── Header
│   ├── 标题：会话树
│   ├── 当前节点摘要
│   └── 重新居中/适应画布
├── Toolbar
│   ├── 设为当前节点
│   ├── 新增子节点/分支
│   ├── 删除所选
│   └── 已选择 N 个节点
├── Canvas
└── Loading / Empty / Error / Confirm Dialog
```

工具栏按钮根据选择状态启用：

- 没有选择：切换、新增和删除均禁用。
- 单选：允许设为当前、允许新增；非根节点允许删除。
- 多选：禁用设为当前和新增，允许批量删除符合条件的节点。
- 选择中包含根节点：根节点不得删除；界面明确说明保护规则。
- 操作进行中：相关操作禁用，防止重复提交。

### 9.2 自定义节点卡片

节点卡片展示：

- role：System / User / Assistant。
- 内容摘要：纯文本、固定行数、省略超长内容。
- sequence 或简短顺序标识。
- Assistant 节点可显示 provider/model 的紧凑标记。
- 当前节点标记。
- 当前路径标记。
- 多选状态。

节点卡片不展示：

- API Key。
- Base URL。
- 完整原始请求或响应元数据。
- 全量长文本。
- Markdown/HTML 的直接解释执行结果。

角色、当前节点、当前路径和选择状态不能只靠颜色区分，应同时使用图标、边框、标签或形状变化。

### 9.3 选择行为

- 普通点击：替换当前选择。
- `Cmd/Ctrl + 点击`：增减多选集合。
- Shift 框选：选择矩形区域内节点。
- 点击空白画布：清空临时选择，不改变 current node。
- Escape：关闭弹窗或清空选择，不能触发删除。
- 节点双击默认不执行危险操作；可以作为未来快捷行为预留，但本阶段不要绑定删除或切换。

### 9.4 新增节点/分支界面

新增操作从一个选中节点开始，弹出轻量对话框或侧面板：

- 显示父节点摘要。
- 输入 role 和内容。
- 明确说明这是 UI Preview。
- 提交后通过 Port 请求 Demo Adapter 更新快照。
- 如果父节点已有子节点，新节点自然形成新分支；图形组件不自行判断领域含义。
- 表单验证失败保持输入，显示字段错误。
- 关闭或取消不产生任何树修改。

### 9.5 删除界面

删除必须经过确认：

- 显示实际将影响的节点数量。
- 清晰区分叶节点删除和子树删除。
- 根节点不可通过普通删除操作移除。
- 多选中如果同时包含祖先和后代，提交前应进行确定性归一化，避免重复删除。
- Demo Adapter 返回最终快照后再更新画布。
- 部分失败必须有明确反馈，不能假装全部成功。

真正接入内核时，应以服务端/内核返回的删除结果为准，前端不得自行假定原子性。

---

## 10. CSP 与 Electron 安全门禁

React Flow 需要本地打包的基础样式，并会在运行时更新节点位置和 viewport。实施前必须完成一个最小兼容性门禁：

1. 安装依赖后，只渲染两个节点和一条边。
2. 使用当前生产 CSP 构建并启动 Electron 预览。
3. 验证节点位置、缩放、平移、选择和框选正常。
4. 检查 DevTools Console 没有 CSP 拒绝信息。
5. 确认所有 CSS 来自本地 bundle，无 CDN 请求。

安全要求：

- 不得为了图形库直接给生产 `script-src` 添加 `'unsafe-inline'` 或 `'unsafe-eval'`。
- 不得直接把生产 `style-src` 放宽为通配符或任意远程源。
- 自定义组件仍禁止 JSX `style={{...}}`，继续使用项目 CSS class 和 CSS Variables。
- React Flow 官方 CSS 必须通过 Vite 打包为本地资源。
- 如果现有 CSP 下 React Flow 的内部定位确实失败，执行 Agent应停止并报告兼容性证据，不得自行弱化安全策略；后续再决定采用更细粒度策略或自绘 SVG 回退方案。

本阶段不得修改 Preload、Main IPC 或 `window.desktopApi`。

---

## 11. 建议文件结构

```text
apps/desktop/src/renderer/src/
  ports/
    conversation-tree-ui.port.ts
    ports.context.tsx
  adapters/
    demo-conversation-tree-ui.adapter.ts
  features/
    session-tree/
      SessionTreePanel.tsx
      ConversationTreeCanvas.tsx
      ConversationTreeNode.tsx
      ConversationTreeToolbar.tsx
      ConversationTreeEmptyState.tsx
      ConversationTreeErrorState.tsx
      ConversationTreeMutationDialog.tsx
      conversation-tree.controller.ts
      conversation-tree.reducer.ts
      conversation-tree-ui.types.ts
      mapping/
        validate-tree-snapshot.ts
        to-flow-elements.ts
      layout/
        dagre-tree-layout.ts
  styles/
    conversation-tree.css

tests/desktop-renderer/
  conversation-tree.mapping.test.ts
  conversation-tree.layout.test.ts
  conversation-tree.demo-adapter.test.ts
  conversation-tree-panel.test.tsx
  conversation-tree-boundaries.test.ts
```

文件可以合并，但必须保留以下逻辑隔离：

- Port/DTO。
- Demo 数据和操作。
- 树验证与展示映射。
- Dagre 布局。
- React Flow 画布。
- 页面容器和操作 UI。

---

## 12. 实施阶段

### 阶段一：基线与兼容性门禁

1. 从最新 `dev` 建立功能分支。
2. 记录工作区已有改动，保护 `docs/todo.md`。
3. 运行当前类型检查、边界检查、Renderer 测试和桌面构建。
4. 将两个依赖只安装到 `chat-desktop`。
5. 完成 React 19、electron-vite、生产 CSP 的最小画布门禁。
6. 门禁失败则停止，不继续堆叠业务组件。

### 阶段二：端口和 Demo Adapter

1. 定义不含第三方图形类型的 UI 快照和 Port。
2. 增加稳定的演示树数据。
3. 实现加载、订阅、切换当前节点、新增和删除的内存行为。
4. 将端口加入 `AppPorts`，由 `App` 注入默认 Demo Adapter。
5. 为 Demo Adapter 编写纯单元测试。

### 阶段三：验证、映射和布局

1. 编写 UI 快照不变量验证器。
2. 编写节点、边的确定性映射。
3. 编写当前路径计算。
4. 使用 Dagre 计算自上而下坐标。
5. 确保输入不变时输出顺序和坐标稳定。
6. 为异常树、分支树、单链树和不同 provider 节点增加测试。

### 阶段四：自定义节点和画布

1. 实现固定尺寸的自定义会话节点。
2. 实现角色、当前节点、当前路径和选择样式。
3. 接入 React Flow 的平移、缩放、单选、多选和框选。
4. 关闭自由连线、业务删除和位置持久化。
5. 增加适应画布和回到当前节点的控制。

### 阶段五：操作界面

1. 实现工具栏和选择计数。
2. 实现显式“设为当前节点”。
3. 实现新增节点/分支对话框。
4. 实现删除确认、根节点保护和批量选择归一化。
5. 处理 loading、success、error 和 partial failure。
6. 确认所有操作只调用 Port。

### 阶段六：回归与收尾

1. 更新原先只检查占位文本的 `ChatPage` 测试。
2. 验证现有聊天 Demo、供应商配置和路由没有回归。
3. 扩展边界检查，禁止 Port 引用 React Flow/Dagre。
4. 检查依赖许可证和 lockfile。
5. 运行完整测试矩阵和生产构建。
6. 手动检查 Electron 开发模式与生产预览。

---

## 13. 测试矩阵

### 13.1 快照验证与映射

- 正常单链树通过验证。
- 正常分支树通过验证。
- 重复 ID 被拒绝。
- 多根、无根或 root ID 错误被拒绝。
- 缺失 parent 被拒绝。
- 自引用和环被拒绝。
- 不可达节点被拒绝。
- current node 不存在时被拒绝。
- 每个非根节点生成且只生成一条入边。
- 节点和边 ID 稳定。
- 当前路径计算正确。

### 13.2 布局

- 根节点位于第一层。
- 子节点位于父节点下一层。
- 同级节点按 sequence 稳定排列。
- 分支节点不重叠。
- 相同输入产生相同坐标。
- 选择变化不触发布局结果变化。
- 新增和删除后可以重新计算有效布局。

### 13.3 Demo Adapter

- 加载返回防御性副本。
- 订阅者可以收到新快照。
- 解除订阅后不再收到事件。
- 切换 current node 成功。
- 不存在的节点切换失败。
- 新增节点形成正确父子关系。
- 父节点已有子节点时可形成新分支。
- 根节点普通删除被拒绝。
- leaf-only 与 subtree 行为可区分。
- 多选祖先/后代删除被确定性处理。
- 操作错误不会破坏原快照。

### 13.4 组件交互

- 加载中显示 loading。
- 加载失败显示错误和重试。
- 演示树显示根、主路径和分支。
- current node 与 selected node 视觉和语义不同。
- 普通点击形成单选。
- Cmd/Ctrl 点击形成多选。
- 框选结果转换为 node ID 集合。
- 点击空白清空选择但不改变 current node。
- 单选时启用切换和新增。
- 多选时禁用切换和新增。
- 根节点不能删除。
- 删除必须确认。
- 操作中禁止重复提交。
- Port 返回失败时显示安全错误。
- 新增/删除成功后画布反映新快照。

### 13.5 架构与安全

- Renderer 不导入 Electron。
- Renderer 不导入 conversation-tree 或 runtime。
- Port 不导入 React Flow 或 Dagre。
- Demo Adapter 不调用 `fetch`。
- 不新增真实 IPC channel。
- 不使用远程资源。
- 自定义代码不新增 JSX inline style。
- API Key 不出现在节点、日志、错误或快照中。
- 生产 CSP 不因本功能被宽泛放松。

### 13.6 测试实现注意事项

- 映射、验证、布局和 Demo Adapter 使用真实实现测试。
- JSDOM 不适合验证真实几何尺寸；不要以脆弱的像素快照代替逻辑测试。
- 组件意图测试可以对 React Flow 做最小边界 mock，验证 props 和回调转换。
- 至少保留一个使用真实 React Flow 的渲染测试或 Electron 手动测试，避免 mock 掩盖集成问题。
- 如需要 `ResizeObserver`，只在测试环境提供最小 polyfill，不把测试补丁带入生产代码。

---

## 14. 验收标准

以下条件全部满足才可交付：

1. 占位文字已替换为真实演示树拓扑。
2. 树清楚显示根节点、父子关系和至少一个分支。
3. 当前节点与临时选择状态可以明确区分。
4. 根到当前节点的路径被正确高亮。
5. 单选、Cmd/Ctrl 多选和框选均可用。
6. 用户可以通过界面请求切换当前节点。
7. 用户可以通过界面新增子节点/分支。
8. 用户可以通过确认流程删除一个或多个允许删除的节点。
9. 根节点受到保护。
10. 图形库不直接拥有或修改业务快照。
11. 所有业务意图都经过 `ConversationTreeUiPort`。
12. Port 和 DTO 不包含 React Flow/Dagre 类型。
13. 本阶段没有连接 Electron IPC 或内核。
14. 现有聊天 Demo、供应商配置和路由继续工作。
15. 生产 CSP 没有被宽泛放松，运行时无 CSP 报错。
16. 类型检查、架构边界、完整测试和桌面生产构建全部通过。

---

## 15. 验证命令

实施者应执行：

```bash
pnpm typecheck
pnpm lint:boundaries
pnpm exec vitest run tests/desktop-renderer
pnpm test
pnpm build:desktop
git diff --check
```

开发模式手动验收：

```bash
pnpm --filter chat-desktop run dev
```

生产构建预览或等价启动也必须检查一次，重点观察：

- DevTools 是否出现 CSP 拒绝。
- 节点坐标、边、缩放和平移是否正常。
- 多选和框选是否正常。
- 当前路径是否正确。
- 新增/删除后布局是否稳定。
- 会话树区域是否出现裁切或覆盖对话输入区。

---

## 16. 交付报告要求

执行 Agent 完成后必须报告：

- 实际安装的 `@xyflow/react` 和 `@dagrejs/dagre` 版本。
- React 19 与生产 CSP 门禁结果。
- 新增和修改的主要文件。
- UI Port 提供的能力范围。
- Demo Adapter 支持的操作与限制。
- 自动化测试命令和结果。
- Electron 手动验证结果。
- 尚未接入的 IPC、内核和持久化能力。
- 是否存在任何安全策略、许可证或兼容性遗留问题。

如果兼容性门禁失败，报告必须包含可复现命令、Console 错误和最小复现范围；不得通过删除安全限制掩盖问题。
