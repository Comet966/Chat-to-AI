import type { ProviderKind, ProviderSettingsData } from '../../ports/provider-settings.port.js'

export type FormStatus =
  | 'pristine'
  | 'editing'
  | 'validating'
  | 'saved-in-memory'
  | 'invalid'
  | 'not-connected'

export interface ProviderSettingsFormState {
  data: ProviderSettingsData
  status: FormStatus
  errors: Partial<Record<keyof ProviderSettingsData, string>>
  noticeMessage: string | null
  showApiKey: boolean
}

export type ProviderSettingsAction =
  | { type: 'fieldChanged'; field: keyof ProviderSettingsData; value: string | number }
  | { type: 'providerChanged'; provider: ProviderKind }
  | { type: 'toggleShowApiKey' }
  | { type: 'clearApiKey' }
  | { type: 'validationFailed'; errors: Partial<Record<keyof ProviderSettingsData, string>> }
  | { type: 'saveSuccess'; message: string }
  | { type: 'testConnectionResult'; message: string }
  | { type: 'resetForm'; data: ProviderSettingsData }
