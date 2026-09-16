import type { ChatModelPort } from 'chat-core'
import type { ChatRole } from 'chat-contracts'
import { DEFAULT_GEMINI_BASE_URL } from './provider-config.js'
import { parseSseStream } from './sse.js'
import { redactSecret } from './provider-config.schema.js'

export interface GeminiGenerateContentModelAdapterOptions {
  baseUrl?: string
  apiKey: string
  modelId: string
  maxOutputTokens?: number
}

export class GeminiGenerateContentModelAdapter implements ChatModelPort {
  public readonly modelId: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly maxOutputTokens?: number

  constructor(options: GeminiGenerateContentModelAdapterOptions) {
    this.baseUrl = (options.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.modelId = options.modelId
    this.maxOutputTokens = options.maxOutputTokens
  }

  public async *streamChat(
    input: { messages: ReadonlyArray<{ role: ChatRole; content: string }> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  > {
    const modelPath = this.modelId.startsWith('models/') ? this.modelId : `models/${this.modelId}`
    const url = `${this.baseUrl}/v1beta/${modelPath}:streamGenerateContent?alt=sse`

    // Role mapping per Section 4.1:
    // Core 'system': temporarily merged into the first user message, noting limitation.
    // Core 'user': 'user'
    // Core 'assistant': 'model'
    const systemMessages = input.messages.filter((m) => m.role === 'system')
    const nonSystemMessages = input.messages.filter((m) => m.role !== 'system')

    let firstUserMerged = false
    const contents = nonSystemMessages.map((m) => {
      if (m.role === 'user' && !firstUserMerged && systemMessages.length > 0) {
        firstUserMerged = true
        const systemPrefix = systemMessages.map((s) => s.content).join('\n\n')
        return {
          role: 'user',
          parts: [{ text: `${systemPrefix}\n\n${m.content}` }]
        }
      }

      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }
    })

    if (!firstUserMerged && systemMessages.length > 0) {
      contents.unshift({
        role: 'user',
        parts: [{ text: systemMessages.map((s) => s.content).join('\n\n') }]
      })
    }

    const requestBody: Record<string, unknown> = {
      contents
    }

    if (this.maxOutputTokens !== undefined && this.maxOutputTokens > 0) {
      requestBody.generationConfig = {
        maxOutputTokens: this.maxOutputTokens
      }
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
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

      try {
        const parsed = JSON.parse(trimmedData) as {
          error?: {
            code?: number
            message?: string
            status?: string
          }
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string
              }>
              role?: string
            }
            finishReason?: string
            index?: number
          }>
        }

        if (parsed.error) {
          const errorMsg = parsed.error.message ?? 'Gemini stream error'
          const redacted = redactSecret(errorMsg, this.apiKey)
          throw new Error(`Provider stream error: ${redacted}`)
        }

        const candidate = parsed.candidates?.[0]
        if (!candidate) {
          continue
        }

        if (candidate.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              yield { type: 'text-delta', text: part.text }
            }
          }
        }

        if (candidate.finishReason) {
          const rawReason = candidate.finishReason.toUpperCase()
          if (rawReason === 'STOP') {
            pendingFinishReason = 'stop'
          } else if (rawReason === 'MAX_TOKENS') {
            pendingFinishReason = 'length'
          } else {
            pendingFinishReason = 'unknown'
          }

          hasFinished = true
          yield { type: 'finish', finishReason: pendingFinishReason }
          return
        }
      } catch (parseError: unknown) {
        if (parseError instanceof Error && parseError.message.startsWith('Provider stream error:')) {
          throw parseError
        }
        // Ignore unparseable or partial SSE JSON chunk
      }
    }

    if (!signal.aborted && !hasFinished) {
      yield { type: 'finish', finishReason: pendingFinishReason }
    }
  }
}
