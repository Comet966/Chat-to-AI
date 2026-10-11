import type { ChatMessageInput } from 'chat-contracts'

export interface ChatModelPort {
  readonly modelId: string

  streamChat(
    input: { messages: ReadonlyArray<ChatMessageInput> },
    signal: AbortSignal
  ): AsyncIterable<
    | { type: 'text-delta'; text: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'unknown' }
  >
}
