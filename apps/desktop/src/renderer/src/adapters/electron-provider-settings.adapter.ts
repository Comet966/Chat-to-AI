import type { DesktopApi } from '../../../shared/desktop-api.contract.js'
import type { DesktopDevPresetDto, DesktopProviderSettingsInput } from '../../../shared/provider.contract.js'
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
    const result = await this.api.saveSettings(this.toInput(data))
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
    const result = await this.api.listModels(this.toInput(data))
    return result.ok
      ? { ok: true, value: result.value.models }
      : { ok: false, error: result.error }
  }

  public async getDevPreset(): Promise<ProviderSettingsResult<DesktopDevPresetDto | null>> {
    const result = await this.api.getDevPreset()
    return result.ok ? result : { ok: false, error: result.error }
  }

  /**
   * Strip UI-only fields (e.g. hasApiKey) that the IPC strict schema rejects.
   */
  private toInput(data: ProviderSettingsData): DesktopProviderSettingsInput {
    return {
      provider: data.provider,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      modelId: data.modelId,
      maxOutputTokens: data.maxOutputTokens,
      ...(data.anthropicVersion ? { anthropicVersion: data.anthropicVersion } : {}),
      ...(data.catalogMode ? { catalogMode: data.catalogMode } : {}),
      ...(data.catalogBaseUrl ? { catalogBaseUrl: data.catalogBaseUrl } : {})
    }
  }
}
