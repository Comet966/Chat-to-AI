import type { DesktopApi } from '../../../shared/desktop-api.contract.js'
import type {
  GenerationPreferencesDto,
  OutputFormat,
  SaveGenerationPreferencesInput
} from '../../../shared/preferences.contract.js'
import type {
  GenerationPreferencesPort,
  PreferencesPortResult
} from '../ports/generation-preferences.port.js'

export class ElectronGenerationPreferencesAdapter implements GenerationPreferencesPort {
  constructor(private readonly api: DesktopApi['preferences']) {}

  public async getPreferences(): Promise<PreferencesPortResult<GenerationPreferencesDto>> {
    const result = await this.api.getPreferences()
    return result.ok
      ? { ok: true, value: structuredClone(result.value) }
      : { ok: false, error: result.error }
  }

  public async savePreferences(
    input: SaveGenerationPreferencesInput
  ): Promise<PreferencesPortResult<void>> {
    const result = await this.api.savePreferences(input)
    return result.ok ? result : { ok: false, error: result.error }
  }

  public async setActiveFormat(format: OutputFormat): Promise<PreferencesPortResult<void>> {
    const result = await this.api.setActiveFormat(format)
    return result.ok ? result : { ok: false, error: result.error }
  }
}
