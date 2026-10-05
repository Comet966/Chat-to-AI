import type {
  ConversationSnapshotDto,
  ConversationTurnAcceptedDto,
  DesktopConversationEvent,
  DesktopConversationResult,
  SetCurrentConversationTurnInput,
  StartConversationTurnInput
} from './conversation.contract.js'
import type {
  DesktopDevPresetDto,
  DesktopModelCatalogDto,
  DesktopProviderResult,
  DesktopProviderSettingsDto,
  DesktopProviderSettingsInput
} from './provider.contract.js'
import type {
  DesktopPreferencesResult,
  GenerationPreferencesDto,
  OutputFormat,
  SaveGenerationPreferencesInput
} from './preferences.contract.js'

export const DESKTOP_IPC_CHANNELS = {
  APP_GET_INFO: 'desktop:app:get-info',
  CONVERSATION_GET_SNAPSHOT: 'desktop:conversation:snapshot:get',
  CONVERSATION_SET_CURRENT: 'desktop:conversation:current:set',
  CONVERSATION_START_TURN: 'desktop:conversation:turn:start',
  CONVERSATION_CANCEL_TURN: 'desktop:conversation:turn:cancel',
  CONVERSATION_EVENT: 'desktop:conversation:event',
  PROVIDER_GET_SETTINGS: 'desktop:provider:settings:get',
  PROVIDER_SAVE_SETTINGS: 'desktop:provider:settings:save',
  PROVIDER_CLEAR_KEY: 'desktop:provider:key:clear',
  PROVIDER_TEST_CONNECTION: 'desktop:provider:connection:test',
  PROVIDER_LIST_MODELS: 'desktop:provider:models:list',
  PROVIDER_GET_DEV_PRESET: 'desktop:provider:dev-preset:get',
  PREFERENCES_GET: 'desktop:preferences:get',
  PREFERENCES_SAVE: 'desktop:preferences:save',
  PREFERENCES_SET_ACTIVE_FORMAT: 'desktop:preferences:set-active-format'
} as const

export type DesktopIpcChannel =
  (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS]

export type DesktopErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_CONNECTED'
  | 'NOT_IMPLEMENTED'
  | 'UNAUTHORIZED_SENDER'
  | 'INTERNAL_ERROR'

export interface DesktopError {
  code: DesktopErrorCode
  message: string
  field?: string
}

export type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopError }

export interface AppInfo {
  name: string
  version: string
  isPackaged: boolean
  platform: string
}

export interface DesktopApi {
  app: {
    getInfo(): Promise<DesktopResult<AppInfo>>
  }
  conversation: {
    getSnapshot(): Promise<DesktopConversationResult<ConversationSnapshotDto>>
    setCurrentTurn(
      input: SetCurrentConversationTurnInput
    ): Promise<DesktopConversationResult<ConversationSnapshotDto>>
    startTurn(
      input: StartConversationTurnInput
    ): Promise<DesktopConversationResult<ConversationTurnAcceptedDto>>
    cancelTurn(): Promise<DesktopConversationResult<void>>
    onEvent(listener: (event: DesktopConversationEvent) => void): () => void
  }
  provider: {
    getSettings(): Promise<DesktopProviderResult<DesktopProviderSettingsDto>>
    saveSettings(input: DesktopProviderSettingsInput): Promise<DesktopProviderResult<void>>
    clearKey(): Promise<DesktopProviderResult<void>>
    testConnection(): Promise<DesktopProviderResult<void>>
    listModels(input: DesktopProviderSettingsInput): Promise<DesktopProviderResult<DesktopModelCatalogDto>>
    getDevPreset(): Promise<DesktopProviderResult<DesktopDevPresetDto | null>>
  }
  preferences: {
    getPreferences(): Promise<DesktopPreferencesResult<GenerationPreferencesDto>>
    savePreferences(input: SaveGenerationPreferencesInput): Promise<DesktopPreferencesResult<void>>
    setActiveFormat(format: OutputFormat): Promise<DesktopPreferencesResult<void>>
  }
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}
