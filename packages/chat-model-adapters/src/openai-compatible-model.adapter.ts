import type { ChatModelPort } from 'chat-core'
import type { ChatRole } from 'chat-contracts'
import { parseSseStream } from './sse.js'
import { redactSecret } from './provider-config.schema.js'

export interface OpenAICompatibleModelAdapterOptions {
  baseUrl: string
  apiKey: string
  modelId: string
}

export class OpenAICompatibleModelAdapter implements ChatModelPort {
  public readonly modelId: string
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(options: OpenAICompatibleModelAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.modelId = options.modelId
  }

  public async *streamChat(
    input: { messages: ReadonlyArray<{ role: ChatRole; content: string }> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  > {
    const url = `${this.baseUrl}/chat/completions`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: input.messages,
          stream: true
        }),
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

    for await (const event of parseSseStream(response.body, signal)) {
      if (signal.aborted) {
        return
      }

      const trimmedData = event.data.trim()
      if (!trimmedData) {
        continue
      }

      if (trimmedData === '[DONE]') {
        hasFinished = true
        yield { type: 'finish', finishReason: 'stop' }
        return
      }

      try {
        const parsed = JSON.parse(trimmedData) as {
          choices?: Array<{
            delta?: { content?: string }
            finish_reason?: string | null
          }>
        }

        const choice = parsed.choices?.[0]
        if (!choice) {
          continue
        }

        if (choice.delta?.content) {
          yield { type: 'text-delta', text: choice.delta.content }
        }

        if (choice.finish_reason) {
          const reason =
            choice.finish_reason === 'stop'
              ? 'stop'
              : choice.finish_reason === 'length'
                ? 'length'
                : 'unknown'
          hasFinished = true
          yield { type: 'finish', finishReason: reason }
          return
        }
      } catch {
        // Ignore unparseable or partial SSE JSON chunk
      }
    }

    if (!signal.aborted && !hasFinished) {
      yield { type: 'finish', finishReason: 'stop' }
    }
  }
}
