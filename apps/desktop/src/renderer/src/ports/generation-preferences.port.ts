import type {
  DesktopPreferencesError,
  GenerationPreferencesDto,
  OutputFormat,
  SaveGenerationPreferencesInput
} from '../../../shared/preferences.contract.js'

export type PreferencesPortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopPreferencesError }

export interface GenerationPreferencesPort {
  getPreferences(): Promise<PreferencesPortResult<GenerationPreferencesDto>>
  savePreferences(input: SaveGenerationPreferencesInput): Promise<PreferencesPortResult<void>>
  setActiveFormat(format: OutputFormat): Promise<PreferencesPortResult<void>>
}
