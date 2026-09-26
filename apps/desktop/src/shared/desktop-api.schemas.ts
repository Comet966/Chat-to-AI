import { z } from 'zod'

export const AppGetInfoInputSchema = z.union([z.record(z.unknown()), z.undefined(), z.null()]).optional()

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  isPackaged: z.boolean(),
  platform: z.string()
})

export type ValidatedAppInfo = z.infer<typeof AppInfoSchema>

const IdSchema = z.string().min(1).max(256)
const ContextSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('root-path'), turnIds: z.array(IdSchema).max(1000) }).strict(),
  z.object({ mode: z.literal('manual'), turnIds: z.array(IdSchema).max(1000) }).strict()
])

export const ConversationEmptyInputSchema = z.object({}).strict()
export const SetCurrentConversationTurnInputSchema = z.object({
  turnId: IdSchema,
  expectedRevision: z.number().int().nonnegative()
}).strict()
export const StartConversationTurnInputSchema = z.object({
  prompt: z.string().min(1).max(32000),
  expectedRevision: z.number().int().nonnegative(),
  currentTurnId: IdSchema.nullable(),
  contextSelection: ContextSelectionSchema
}).strict()

export const DesktopConversationErrorSchema = z.object({
  code: z.enum([
    'NOT_CONFIGURED',
    'TREE_NOT_FOUND',
    'TURN_NOT_FOUND',
    'TURN_IN_PROGRESS',
    'VERSION_CONFLICT',
    'INVALID_CONTEXT_SELECTION',
    'VALIDATION_FAILED',
    'UNAUTHORIZED_SENDER',
    'MODEL_REQUEST_FAILED',
    'CANCELLED',
    'INTERNAL_ERROR'
  ]),
  message: z.string().max(2000)
}).strict()

export const ConversationTurnSchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  question: z.string().min(1).max(32000),
  answer: z.string().min(1).max(100000),
  sequence: z.number().int().nonnegative(),
  createdAt: z.string().min(1).max(128),
  providerInfo: z.object({
    provider: z.string().min(1).max(128),
    modelId: z.string().min(1).max(256)
  }).strict().optional()
}).strict()

export const ConversationSnapshotSchema = z.object({
  treeId: IdSchema,
  revision: z.number().int().nonnegative(),
  rootTurnId: IdSchema.nullable(),
  currentTurnId: IdSchema.nullable(),
  turns: z.array(ConversationTurnSchema).max(1000)
}).strict()

const ConversationResultErrorSchema = z.object({
  ok: z.literal(false),
  error: DesktopConversationErrorSchema
}).strict()

export const ConversationSnapshotResultSchema = z.union([
  z.object({ ok: z.literal(true), value: ConversationSnapshotSchema }).strict(),
  ConversationResultErrorSchema
])
export const ConversationTurnAcceptedResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    value: z.object({ requestId: IdSchema }).strict()
  }).strict(),
  ConversationResultErrorSchema
])
export const ConversationVoidResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.undefined() }).strict(),
  ConversationResultErrorSchema
])

export const DesktopConversationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation.turn.started'), schemaVersion: z.literal(1),
    requestId: IdSchema, treeId: IdSchema
  }).strict(),
  z.object({
    type: z.literal('conversation.turn.delta'), schemaVersion: z.literal(1),
    requestId: IdSchema, treeId: IdSchema, sequence: z.number().int().nonnegative(),
    delta: z.string().max(32000)
  }).strict(),
  z.object({
    type: z.literal('conversation.turn.completed'), schemaVersion: z.literal(1),
    requestId: IdSchema, treeId: IdSchema,
    finishReason: z.enum(['stop', 'length', 'unknown'])
  }).strict(),
  z.object({
    type: z.literal('conversation.turn.failed'), schemaVersion: z.literal(1),
    requestId: IdSchema, treeId: IdSchema, error: DesktopConversationErrorSchema
  }).strict(),
  z.object({
    type: z.literal('conversation.turn.cancelled'), schemaVersion: z.literal(1),
    requestId: IdSchema, treeId: IdSchema
  }).strict(),
  z.object({
    type: z.literal('conversation.snapshot.changed'), schemaVersion: z.literal(1),
    treeId: IdSchema, snapshot: ConversationSnapshotSchema
  }).strict()
])
