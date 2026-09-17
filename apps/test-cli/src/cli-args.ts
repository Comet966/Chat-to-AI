export interface CliParsedArgs {
  provider?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
  maxOutputTokens?: number
  prompt?: string
  timeoutMs?: number
  format?: 'text' | 'jsonl'
  noColor?: boolean
  interactive?: boolean
  treeId?: string
  showTree?: boolean
  treeContentWidth?: number
  help?: boolean
  version?: boolean
}

export type ParseArgsResult =
  | { success: true; args: CliParsedArgs }
  | { success: false; error: string }

export function parseCliArgs(rawArgs: string[]): ParseArgsResult {
  const args: CliParsedArgs = {}

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]

    if (arg === '--help' || arg === '-h') {
      args.help = true
      return { success: true, args }
    }

    if (arg === '--version' || arg === '-v') {
      args.version = true
      return { success: true, args }
    }

    if (arg === '--no-color') {
      args.noColor = true
      continue
    }

    if (arg === '--interactive') {
      args.interactive = true
      continue
    }

    if (arg === '--show-tree') {
      args.showTree = true
      continue
    }

    if (arg === '--tree-id') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --tree-id requires a value' }
      }
      args.treeId = val
      continue
    }

    if (arg === '--tree-content-width') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --tree-content-width requires a value' }
      }
      const parsedNum = Number(val)
      if (!Number.isInteger(parsedNum) || parsedNum <= 0) {
        return { success: false, error: 'Option --tree-content-width must be a positive integer' }
      }
      args.treeContentWidth = parsedNum
      continue
    }

    if (arg === '--provider') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --provider requires a value' }
      }
      args.provider = val
      continue
    }

    if (arg === '--base-url') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --base-url requires a value' }
      }
      args.baseUrl = val
      continue
    }

    if (arg === '--api-key') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --api-key requires a value' }
      }
      args.apiKey = val
      continue
    }

    if (arg === '--model-id') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --model-id requires a value' }
      }
      args.modelId = val
      continue
    }

    if (arg === '--max-output-tokens') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --max-output-tokens requires a value' }
      }
      const parsedNum = Number(val)
      if (!Number.isInteger(parsedNum) || parsedNum <= 0) {
        return { success: false, error: 'Option --max-output-tokens must be a positive integer' }
      }
      args.maxOutputTokens = parsedNum
      continue
    }

    if (arg === '--prompt') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --prompt requires a value' }
      }
      args.prompt = val
      continue
    }

    if (arg === '--timeout-ms') {
      const val = rawArgs[++i]
      if (val === undefined || val.startsWith('-')) {
        return { success: false, error: 'Option --timeout-ms requires a value' }
      }
      const parsedNum = Number(val)
      if (!Number.isInteger(parsedNum) || parsedNum <= 0) {
        return { success: false, error: 'Option --timeout-ms must be a positive integer' }
      }
      args.timeoutMs = parsedNum
      continue
    }

    if (arg === '--format') {
      const val = rawArgs[++i]
      if (val !== 'text' && val !== 'jsonl') {
        return { success: false, error: "Option --format must be either 'text' or 'jsonl'" }
      }
      args.format = val
      continue
    }

    return { success: false, error: `Unknown option: ${arg}` }
  }

  return { success: true, args }
}

export function getHelpText(): string {
  return `Usage: chat-test-cli [options]

Headless CLI tool to test and verify the ChatKernel stream directly.

Options:
  --provider <kind>        Model provider kind: 'openai-compatible', 'anthropic', 'gemini' (default: 'openai-compatible', env: AI_PROVIDER)
  --base-url <url>         API base URL (env: AI_API_BASE_URL)
  --api-key <key>          API key for authentication (env: AI_API_KEY)
  --model-id <id>          Model identifier (env: AI_MODEL_ID)
  --max-output-tokens <n>  Maximum output tokens to generate (default: 1024, env: AI_MAX_OUTPUT_TOKENS)
  --prompt <text>          Prompt content (if omitted, reads once from stdin)
  --timeout-ms <n>         Request timeout in milliseconds (default: 120000, env: AI_CLI_TIMEOUT_MS)
  --format <format>        Output format: 'text' or 'jsonl' (default: 'text', env: AI_CLI_FORMAT)
  --no-color               Disable terminal colors (env: NO_COLOR)
  --interactive            Launch multi-turn interactive REPL session mode
  --tree-id <id>           Specify in-memory conversation tree ID
  --show-tree              Print tree topology after every completed turn
  --tree-content-width <n> Maximum characters per node content in tree preview (default: 40)
  --help, -h               Show this help message and exit
  --version, -v            Show version and exit

Security Notice:
  Passing --api-key via CLI arguments may expose it in system process listings.
  It is strongly recommended to use the AI_API_KEY environment variable instead.
`
}
