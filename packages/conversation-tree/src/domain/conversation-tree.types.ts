export type ConversationTreeId = string
export type ConversationNodeId = string
export type ConversationRole = 'system' | 'user' | 'assistant'

export interface GenerationProvenance {
  readonly providerId: string
  readonly modelId: string
}

export type ConversationTreeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: import('./conversation-tree.errors.js').ConversationTreeError }
