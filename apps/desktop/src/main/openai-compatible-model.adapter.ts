import type { ChatModelPort } from 'chat-core'
import type { ChatRole } from 'chat-contracts'

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

    const response = await fetch(url, {
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

    if (!response.ok) {
      const status = response.status
      const errorText = await response.text().catch(() => '')
      const error = new Error(`Provider HTTP ${status}: ${errorText}`)
      ;(error as unknown as { status: number }).status = status
      throw error
    }

    if (!response.body) {
      throw new Error('Response body is empty')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) {
            continue
          }

          if (trimmed === 'data: [DONE]') {
            yield { type: 'finish', finishReason: 'stop' }
            return
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim()
            if (!dataStr) continue

            try {
              const parsed = JSON.parse(dataStr) as {
                choices?: Array<{
                  delta?: { content?: string }
                  finish_reason?: string | null
                }>
              }

              const choice = parsed.choices?.[0]
              if (!choice) continue

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
                yield { type: 'finish', finishReason: reason }
                return
              }
            } catch {
              // Ignore partial or unparseable SSE line
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (!signal.aborted) {
      yield { type: 'finish', finishReason: 'stop' }
    }
  }
}
