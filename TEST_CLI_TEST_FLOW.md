# test-cli 测试流程与命令

> 分支：`test-cli`  
> 目标：验证单模型、单会话、流式输出链路，不依赖 Electron 或 React。

## 1. 前置条件

在仓库根目录执行：

```bash
git switch test-cli
pnpm install
```

如果依赖已经安装，可跳过 `pnpm install`。

## 2. 构建 CLI

```bash
pnpm build:test-cli
```

该命令会先构建共享模型适配器，再构建 `apps/test-cli`。

查看帮助和版本：

```bash
pnpm cli:test --help
pnpm cli:test --version
```

## 3. 配置方式

支持命令行参数和环境变量。命令行参数优先级高于环境变量。

| 配置 | 命令行参数 | 环境变量 | 必需 |
|---|---|---|---:|
| API Base URL | `--base-url` | `AI_API_BASE_URL` | 是 |
| API Key | `--api-key` | `AI_API_KEY` | 是 |
| Model ID | `--model-id` | `AI_MODEL_ID` | 是 |
| Prompt | `--prompt` | —，也可从 stdin 读取 | 是 |
| 超时毫秒数 | `--timeout-ms` | `AI_CLI_TIMEOUT_MS` | 否 |
| 输出格式 | `--format text\|jsonl` | `AI_CLI_FORMAT` | 否 |
| 禁用颜色 | `--no-color` | `NO_COLOR` | 否 |

推荐把 API Key 放在环境变量中，避免出现在系统进程列表中。

## 4. 文本流式输出测试

```bash
AI_API_BASE_URL="https://your-provider.example.com/v1" \
AI_API_KEY="your-api-key" \
AI_MODEL_ID="your-model-id" \
pnpm cli:test \
  --prompt "请只回复 OK" \
  --no-color
```

适配器请求的最终地址为：

```text
{base-url}/chat/completions
```

因此 `--base-url` 应填写 API 根地址，不要包含 `/chat/completions`。

## 5. JSONL 流式输出测试

```bash
AI_API_BASE_URL="https://your-provider.example.com/v1" \
AI_API_KEY="your-api-key" \
AI_MODEL_ID="your-model-id" \
pnpm cli:test \
  --prompt "请只回复 OK" \
  --format jsonl \
  --no-color
```

标准输出每行一个 JSON 事件，例如：

```json
{"type":"chat.stream.started","requestId":"...","conversationId":"...","assistantMessageId":"..."}
{"type":"chat.stream.delta","requestId":"...","sequence":0,"delta":"OK"}
{"type":"chat.stream.completed","requestId":"...","finishReason":"stop"}
```

标准错误只用于诊断、取消提示和错误信息，不应包含 API Key。

## 6. stdin 输入测试

不传 `--prompt` 时，CLI 从 stdin 读取一次完整提示词：

```bash
printf '%s\n' '请只回复 OK' | \
env \
  AI_API_BASE_URL="https://your-provider.example.com/v1" \
  AI_API_KEY="your-api-key" \
  AI_MODEL_ID="your-model-id" \
  pnpm cli:test --no-color
```

## 7. 超时与取消测试

设置较短的请求超时时间：

```bash
AI_API_BASE_URL="..." \
AI_API_KEY="..." \
AI_MODEL_ID="..." \
pnpm cli:test \
  --prompt "测试超时" \
  --timeout-ms 30000 \
  --no-color
```

运行期间按 `Ctrl-C` 验证取消链路。CLI 应通过 `ChatKernel.cancel()` 取消请求并退出。

## 8. 自动化检查

只检查 CLI：

```bash
pnpm typecheck:test-cli
pnpm test:test-cli
pnpm build:test-cli
```

检查依赖边界：

```bash
pnpm lint:boundaries
```

全项目回归：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 9. 退出码验收

直接运行构建产物时可以获得准确退出码：

```bash
node apps/test-cli/dist/main.js --prompt "hello" --no-color
echo "exit=$?"
```

| 退出码 | 含义 |
|---:|---|
| 0 | 成功 |
| 1 | 未知错误 |
| 2 | 参数或配置错误 |
| 3 | Provider 鉴权失败 |
| 4 | Provider 限流 |
| 5 | Provider 不可用或网络错误 |
| 6 | 请求超时 |
| 130 | Ctrl-C 中断 |

## 10. 验收标准

- `pnpm cli:test --help` 和 `pnpm cli:test --version` 正常工作。
- text 模式收到 delta 后立即写入 stdout，完成时补换行。
- jsonl 模式 stdout 只包含合法 JSONL，事件顺序与 Core 一致。
- Prompt 缺失、Base URL 非法、未知参数等情况返回退出码 2。
- API Key 不出现在 stdout、诊断日志或错误输出中。
- Ctrl-C 使用 Kernel 的取消端口，退出码为 130。
- 超时退出码为 6。
- CLI 不依赖 Electron、React、BrowserWindow 或 DOM。
