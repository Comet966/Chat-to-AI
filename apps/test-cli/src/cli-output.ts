import type { ChatEvent } from 'chat-contracts'
import type { ConversationTurnEvent } from 'chat-conversation-runtime'
import type { ConversationNodeId, ConversationTreeSnapshot } from 'chat-conversation-tree'
import { redactSecret } from './cli-config.js'
import { renderConversationTree } from './conversation-tree.renderer.js'

export interface OutputStreams {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export class CliOutputHandler {
  private readonly format: 'text' | 'jsonl'
  private readonly apiKey: string
  private readonly noColor: boolean
  private readonly stdout: (text: string) => void
  private readonly stderr: (text: string) => void
  private hasPrintedDelta = false

  constructor(
    format: 'text' | 'jsonl',
    apiKey: string,
    noColor = false,
    streams?: OutputStreams
  ) {
    this.format = format
    this.apiKey = apiKey
    this.noColor = noColor
    this.stdout = streams?.stdout ?? ((text: string) => process.stdout.write(text))
    this.stderr = streams?.stderr ?? ((text: string) => process.stderr.write(text))
  }

  public handleEvent(event: ChatEvent): void {
    if (this.format === 'jsonl') {
      const sanitized = this.sanitizeJsonlEvent(event)
      this.stdout(JSON.stringify(sanitized) + '\n')
      return
    }

    // Text format
    if (event.type === 'chat.stream.delta') {
      this.hasPrintedDelta = true
      this.stdout(event.delta)
    } else if (event.type === 'chat.stream.completed') {
      if (this.hasPrintedDelta) {
        this.stdout('\n')
        this.hasPrintedDelta = false
      }
    }
  }

  public handleTurnEvent(event: ConversationTurnEvent): void {
    if (this.format === 'jsonl') {
      const sanitized = this.sanitizeJsonlEvent(event)
      this.stdout(JSON.stringify(sanitized) + '\n')
      return
    }

    // Text format
    if (event.type === 'conversation.turn.delta') {
      this.hasPrintedDelta = true
      this.stdout(event.delta)
    } else if (event.type === 'conversation.turn.completed') {
      if (this.hasPrintedDelta) {
        this.stdout('\n')
        this.hasPrintedDelta = false
      }
    }
  }

  public writeTree(
    snapshot: ConversationTreeSnapshot,
    currentNodeId: ConversationNodeId,
    contentWidth = 40
  ): void {
    if (this.format === 'jsonl') {
      const payload = {
        type: 'cli.tree.snapshot',
        treeId: snapshot.treeId,
        currentNodeId,
        snapshot
      }
      this.stdout(JSON.stringify(payload) + '\n')
      return
    }

    const rendered = renderConversationTree(snapshot, currentNodeId, {
      contentWidth,
      color: !this.noColor
    })
    this.stdout(rendered + '\n')
  }

  public writeRaw(text: string): void {
    this.stdout(text)
  }

  public writeDiagnostic(message: string): void {
    const redacted = redactSecret(message, this.apiKey)
    const formatted = this.noColor ? `[info] ${redacted}\n` : `\x1b[36m[info]\x1b[0m ${redacted}\n`
    this.stderr(formatted)
  }

  public writeError(message: string): void {
    const redacted = redactSecret(message, this.apiKey)
    const formatted = this.noColor ? `[error] ${redacted}\n` : `\x1b[31m[error]\x1b[0m ${redacted}\n`
    this.stderr(formatted)
  }

  public writeCancelNotice(): void {
    const formatted = this.noColor ? `[notice] Request cancelled by user/timeout\n` : `\x1b[33m[notice]\x1b[0m Request cancelled by user/timeout\n`
    this.stderr(formatted)
  }

  private sanitizeJsonlEvent(event: object): Record<string, unknown> {
    const copy = { ...event } as Record<string, unknown>
    if (copy.error && typeof copy.error === 'object') {
      const err = copy.error as { message?: string }
      if (err.message) {
        err.message = redactSecret(err.message, this.apiKey)
      }
    }
    return copy
  }
}
