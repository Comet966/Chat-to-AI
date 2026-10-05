import {
  DEFAULT_GENERATION_PREFERENCES,
  type DesktopPreferencesResult,
  type GenerationPreferencesDto,
  type OutputFormat,
  type SaveGenerationPreferencesInput
} from '../../shared/preferences.contract.js'

export class GenerationPreferencesService {
  private preferences: GenerationPreferencesDto

  constructor(initialPreferences?: GenerationPreferencesDto) {
    this.preferences = initialPreferences ?? { ...DEFAULT_GENERATION_PREFERENCES }
  }

  public getPreferences(): DesktopPreferencesResult<GenerationPreferencesDto> {
    return {
      ok: true,
      value: structuredClone(this.preferences)
    }
  }

  public savePreferences(
    input: SaveGenerationPreferencesInput
  ): DesktopPreferencesResult<void> {
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

    if (input.activeFormat !== 'markdown' && input.activeFormat !== 'html') {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Active format must be markdown or html',
          field: 'activeFormat'
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

  public setActiveFormat(format: OutputFormat): DesktopPreferencesResult<void> {
    if (format !== 'markdown' && format !== 'html') {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Active format must be markdown or html',
          field: 'format'
        }
      }
    }

    this.preferences = {
      ...this.preferences,
      activeFormat: format
    }

    return { ok: true, value: undefined }
  }

  public resetToDefault(): DesktopPreferencesResult<void> {
    this.preferences = {
      ...DEFAULT_GENERATION_PREFERENCES,
      version: this.preferences.version + 1
    }
    return { ok: true, value: undefined }
  }
}
