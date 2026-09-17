import { parseCliArgs, getHelpText } from './cli-args.js'
import { resolveCliConfig } from './cli-config.js'
import { CLI_EXIT_CODES } from './cli-exit-codes.js'
import { CliOutputHandler } from './cli-output.js'
import { runCli } from './cli-runner.js'
import { runSessionCli } from './session-cli-runner.js'

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return ''
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

export async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  const parseResult = parseCliArgs(rawArgs)

  if (!parseResult.success) {
    process.stderr.write(`[error] ${parseResult.error}\n\n`)
    process.stderr.write(getHelpText())
    process.exit(CLI_EXIT_CODES.INVALID_ARGUMENTS)
  }

  const { args } = parseResult

  if (args.help) {
    process.stdout.write(getHelpText())
    process.exit(CLI_EXIT_CODES.SUCCESS)
  }

  if (args.version) {
    process.stdout.write('chat-test-cli v0.1.0\n')
    process.exit(CLI_EXIT_CODES.SUCCESS)
  }

  let stdinContent: string | undefined
  if (!args.interactive && !args.prompt) {
    stdinContent = await readStdin()
  }

  const configResult = resolveCliConfig(args, process.env, stdinContent)
  if (!configResult.success) {
    process.stderr.write(`[error] ${configResult.error}\n`)
    process.exit(CLI_EXIT_CODES.INVALID_ARGUMENTS)
  }

  const { config } = configResult
  const output = new CliOutputHandler(config.format, config.apiKey, config.noColor)

  if (config.interactive) {
    const { exitCode } = await runSessionCli({ config, output })
    process.exit(exitCode)
  } else {
    const { exitCode } = await runCli({ config, output })
    process.exit(exitCode)
  }
}

// If executed directly as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[fatal] Uncaught CLI exception: ${message}\n`)
    process.exit(CLI_EXIT_CODES.UNKNOWN_ERROR)
  })
}
