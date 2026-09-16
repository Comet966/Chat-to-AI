import type { ChatModelPort } from 'chat-core'
import type { ChatRole } from 'chat-contracts'
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_MAX_OUTPUT_TOKENS
} from './provider-config.js'
import { parseSseStream } from './sse.js'
import { redactSecret } from './provider-config.schema.js'

export interface AnthropicMessagesModelAdapterOptions {
  baseUrl?: string
  apiKey: string
  modelId: string
  maxOutputTokens?: number
  anthropicVersion?: string
}

export class AnthropicMessagesModelAdapter implements ChatModelPort {
  public readonly modelId: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly maxOutputTokens: number
  private readonly anthropicVersion: string

  constructor(options: AnthropicMessagesModelAdapterOptions) {
    this.baseUrl = (options.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.modelId = options.modelId
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION
  }

  public async *streamChat(
    input: { messages: ReadonlyArray<{ role: ChatRole; content: string }> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  > {
    const url = `${this.baseUrl}/v1/messages`

    const systemMessages = input.messages.filter((m) => m.role === 'system')
    const nonSystemMessages = input.messages.filter((m) => m.role !== 'system')

    const requestMessages = nonSystemMessages.map((m) => ({
      role: m.role,
      content: m.content
    }))

    const requestBody: Record<string, unknown> = {
      model: this.modelId,
      max_tokens: this.maxOutputTokens,
      messages: requestMessages,
      stream: true
    }

    if (systemMessages.length > 0) {
      requestBody.system = systemMessages.map((m) => m.content).join('\n\n')
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion
        },
        body: JSON.stringify(requestBody),
        signal
      })
    } catch (fetchError: unknown) {
      if (fetchError && typeof fetchError === 'object') {
        const anyErr = fetchError as Record<string, unknown>
        const causeCode = (anyErr.cause as { code?: string } | undefined)?.code
        if (causeCode && !anyErr.code) {
          anyErr.code = causeCode
        }
      }
      throw fetchError
    }

    if (!response.ok) {
      const status = response.status
      const errorText = await response.text().catch(() => '')
      const redacted = redactSecret(errorText.slice(0, 500), this.apiKey)
      const error = new Error(`Provider HTTP ${status}: ${redacted}`)
      ;(error as unknown as { status: number }).status = status
      throw error
    }

    if (!response.body) {
      throw new Error('Response body is empty')
    }

    let hasFinished = false
    let pendingFinishReason: 'stop' | 'length' | 'unknown' = 'stop'

    for await (const event of parseSseStream(response.body, signal)) {
      if (signal.aborted) {
        return
      }

      const trimmedData = event.data.trim()
      if (!trimmedData) {
        continue
      }

      // Check for error event or error object
      if (event.event === 'error') {
        let errorMsg = 'Anthropic stream error'
        try {
          const parsed = JSON.parse(trimmedData) as { error?: { message?: string } }
          if (parsed.error?.message) {
            errorMsg = parsed.error.message
          }
        } catch {
          // Use default errorMsg
        }
        const redacted = redactSecret(errorMsg, this.apiKey)
        throw new Error(`Provider stream error: ${redacted}`)
      }

      try {
        const parsed = JSON.parse(trimmedData) as {
          type?: string
          delta?: {
            type?: string
            text?: string
            stop_reason?: string | null
          }
          error?: {
            message?: string
          }
        }

        if (parsed.type === 'error' || parsed.error) {
          const errorMsg = parsed.error?.message ?? 'Anthropic stream error'
          const redacted = redactSecret(errorMsg, this.apiKey)
          throw new Error(`Provider stream error: ${redacted}`)
        }

        // Handle message_delta: capture stop_reason
        if (event.event === 'message_delta' || parsed.type === 'message_delta') {
          const stopReason = parsed.delta?.stop_reason
          if (stopReason === 'max_tokens') {
            pendingFinishReason = 'length'
          } else if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
            pendingFinishReason = 'stop'
          } else if (stopReason) {
            pendingFinishReason = 'unknown'
          }
          continue
        }

        // Handle content_block_delta: yield text_delta
        if (event.event === 'content_block_delta' || parsed.type === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
            yield { type: 'text-delta', text: parsed.delta.text }
          }
          continue
        }

        // Handle message_stop: stream terminal event
        if (event.event === 'message_stop' || parsed.type === 'message_stop') {
          hasFinished = true
          yield { type: 'finish', finishReason: pendingFinishReason }
          return
        }

        // Safe ignore for message_start, content_block_start, content_block_stop, ping, etc.
      } catch (parseError: unknown) {
        // If it's a Provider stream error, rethrow it
        if (parseError instanceof Error && parseError.message.startsWith('Provider stream error:')) {
          throw parseError
        }
        // Ignore unparseable or unknown SSE events
      }
    }

    if (!signal.aborted && !hasFinished) {
      yield { type: 'finish', finishReason: pendingFinishReason }
    }
  }
}
