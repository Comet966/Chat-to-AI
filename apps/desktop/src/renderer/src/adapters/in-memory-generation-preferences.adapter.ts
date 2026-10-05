import {
  DEFAULT_GENERATION_PREFERENCES,
  type GenerationPreferencesDto,
  type OutputFormat,
  type SaveGenerationPreferencesInput
} from '../../../shared/preferences.contract.js'
import type {
  GenerationPreferencesPort,
  PreferencesPortResult
} from '../ports/generation-preferences.port.js'

export class InMemoryGenerationPreferencesAdapter implements GenerationPreferencesPort {
  private preferences: GenerationPreferencesDto

  constructor(initialPreferences?: Partial<GenerationPreferencesDto>) {
    this.preferences = {
      ...DEFAULT_GENERATION_PREFERENCES,
      ...initialPreferences
    }
  }

  public async getPreferences(): Promise<PreferencesPortResult<GenerationPreferencesDto>> {
    return { ok: true, value: structuredClone(this.preferences) }
  }

  public async savePreferences(
    input: SaveGenerationPreferencesInput
  ): Promise<PreferencesPortResult<void>> {
    const markdownTemplate = input.markdownTemplate.trim()
    const htmlTemplate = input.htmlTemplate.trim()

    if (markdownTemplate.length < 10 || markdownTemplate.length > 4000) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Markdown template must be between 10 and 4000 characters',
          field: 'markdownTemplate'
        }
      }
    }

    if (htmlTemplate.length < 10 || htmlTemplate.length > 4000) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'HTML template must be between 10 and 4000 characters',
          field: 'htmlTemplate'
        }
      }
    }

    this.preferences = {
      activeFormat: input.activeFormat,
      markdownTemplate,
      htmlTemplate,
      version: this.preferences.version + 1
    }
    return { ok: true, value: undefined }
  }

  public async setActiveFormat(format: OutputFormat): Promise<PreferencesPortResult<void>> {
    this.preferences = {
      ...this.preferences,
      activeFormat: format
    }
    return { ok: true, value: undefined }
  }
}
