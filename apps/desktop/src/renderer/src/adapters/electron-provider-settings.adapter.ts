import type { DesktopApi } from '../../../shared/desktop-api.contract.js'
import type {
  ProviderSettingsData,
  ProviderSettingsPort,
  ProviderSettingsResult
} from '../ports/provider-settings.port.js'

export class ElectronProviderSettingsAdapter implements ProviderSettingsPort {
  constructor(private readonly api: DesktopApi['provider']) {}

  public async getSettings(): Promise<ProviderSettingsResult<ProviderSettingsData>> {
    const result = await this.api.getSettings()
    return result.ok
      ? { ok: true, value: { ...result.value } }
      : { ok: false, error: result.error }
  }

  public async saveSettings(data: ProviderSettingsData): Promise<ProviderSettingsResult<void>> {
    const result = await this.api.saveSettings(data)
    return result.ok ? result : { ok: false, error: result.error }
  }

  public async clearKey(): Promise<void> {
    await this.api.clearKey()
  }

  public async testConnection(): Promise<ProviderSettingsResult<void>> {
    const result = await this.api.testConnection()
    return result.ok ? result : { ok: false, error: result.error }
  }

  public async listModels(
    data: ProviderSettingsData
  ): Promise<ProviderSettingsResult<readonly string[]>> {
    const result = await this.api.listModels(data)
    return result.ok
      ? { ok: true, value: result.value.models }
      : { ok: false, error: result.error }
  }
}
