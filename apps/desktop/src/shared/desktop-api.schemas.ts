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
  }).strict().optional(),
  declaredOutputFormat: z.enum(['markdown', 'html']).optional(),
  templateVersion: z.number().int().positive().optional()
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

export const ProviderSettingsInputSchema = z.object({
  provider: z.enum(['openai-compatible', 'anthropic', 'gemini']),
  baseUrl: z.string().min(1).max(2048),
  apiKey: z.string().max(4096),
  hasApiKey: z.boolean().optional(),
  modelId: z.string().min(1).max(256),
  maxOutputTokens: z.number().int().positive().max(1_000_000),
  anthropicVersion: z.string().min(1).max(64).optional(),
  catalogMode: z.enum(['provider-native', 'openai-compatible', 'manual-only']).optional(),
  catalogBaseUrl: z.string().min(1).max(2048).optional()
}).strict()

export const ProviderSettingsSchema = ProviderSettingsInputSchema.extend({
  hasApiKey: z.boolean()
}).strict()

export const DesktopProviderErrorSchema = z.object({
  code: z.enum([
    'NOT_CONFIGURED',
    'TURN_IN_PROGRESS',
    'VALIDATION_FAILED',
    'UNAUTHORIZED_SENDER',
    'CONNECTION_FAILED',
    'INTERNAL_ERROR'
  ]),
  message: z.string().max(2000),
  field: z.string().max(128).optional()
}).strict()

const ProviderResultErrorSchema = z.object({
  ok: z.literal(false),
  error: DesktopProviderErrorSchema
}).strict()

export const ProviderSettingsResultSchema = z.union([
  z.object({ ok: z.literal(true), value: ProviderSettingsSchema }).strict(),
  ProviderResultErrorSchema
])
export const ProviderVoidResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.undefined() }).strict(),
  ProviderResultErrorSchema
])
export const ProviderModelCatalogResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    value: z.object({
      models: z.array(z.string().min(1).max(256)).max(500),
      supportsManualEntry: z.literal(true),
      actualCatalogMode: z.enum(['provider-native', 'openai-compatible', 'manual-only']).optional()
    }).strict()
  }).strict(),
  ProviderResultErrorSchema
])

export const DesktopDevPresetSchema = z.object({
  provider: z.enum(['openai-compatible', 'anthropic', 'gemini']),
  baseUrl: z.string().min(1).max(2048),
  modelId: z.string().min(1).max(256),
  maxOutputTokens: z.number().int().positive().max(1_000_000),
  anthropicVersion: z.string().min(1).max(64).optional(),
  catalogMode: z.enum(['provider-native', 'openai-compatible', 'manual-only']),
  catalogBaseUrl: z.string().min(1).max(2048).optional(),
  hasApiKey: z.boolean()
}).strict()

export const ProviderDevPresetResultSchema = z.union([
  z.object({ ok: z.literal(true), value: DesktopDevPresetSchema.nullable() }).strict(),
  ProviderResultErrorSchema
])

// Generation Preferences Schemas
export const OutputFormatSchema = z.enum(['markdown', 'html'])

export const GenerationPreferencesSchema = z.object({
  activeFormat: OutputFormatSchema,
  markdownTemplate: z.string().min(10).max(4000),
  htmlTemplate: z.string().min(10).max(4000),
  version: z.number().int().positive()
}).strict()

export const SaveGenerationPreferencesInputSchema = z.object({
  activeFormat: OutputFormatSchema,
  markdownTemplate: z.string().min(10).max(4000),
  htmlTemplate: z.string().min(10).max(4000)
}).strict()

export const SetActiveFormatInputSchema = z.object({
  format: OutputFormatSchema
}).strict()

export const DesktopPreferencesErrorSchema = z.object({
  code: z.enum(['VALIDATION_FAILED', 'UNAUTHORIZED_SENDER', 'INTERNAL_ERROR']),
  message: z.string().max(2000),
  field: z.string().max(128).optional()
}).strict()

const PreferencesResultErrorSchema = z.object({
  ok: z.literal(false),
  error: DesktopPreferencesErrorSchema
}).strict()

export const PreferencesResultSchema = z.union([
  z.object({ ok: z.literal(true), value: GenerationPreferencesSchema }).strict(),
  PreferencesResultErrorSchema
])

export const PreferencesVoidResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.undefined() }).strict(),
  PreferencesResultErrorSchema
])
