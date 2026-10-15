import type { ProviderKind, ProviderSettingsData } from '../../ports/provider-settings.port.js'
import { normalizedProviderEndpoint } from '../../utils/provider-endpoint.js'
import type {
  ProviderSettingsAction,
  ProviderSettingsFormState
} from './provider-settings.types.js'

export const PROVIDER_DEFAULTS: Record<ProviderKind, { baseUrl: string; modelId: string; anthropicVersion?: string }> = {
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    modelId: 'claude-3-5-sonnet-20241022',
    anthropicVersion: '2023-06-01'
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    modelId: 'gemini-1.5-pro'
  }
}

export function hasConfiguredKey(state: ProviderSettingsFormState): boolean {
  const endpoint = normalizedProviderEndpoint(state.data.baseUrl)
  return !!state.keyScope && state.keyScope.provider === state.data.provider && endpoint !== null &&
    endpoint === normalizedProviderEndpoint(state.keyScope.baseUrl)
}

export function providerSettingsReducer(
  state: ProviderSettingsFormState,
  action: ProviderSettingsAction
): ProviderSettingsFormState {
  switch (action.type) {
    case 'fieldChanged': {
      return {
        ...state,
        status: 'editing',
        data: {
          ...state.data,
          [action.field]: action.value
        },
        errors: {
          ...state.errors,
          [action.field]: undefined
        },
        noticeMessage: null
      }
    }

    case 'providerChanged': {
      const defaults = PROVIDER_DEFAULTS[action.provider]
      return {
        ...state,
        status: 'editing',
        data: {
          ...state.data,
          provider: action.provider,
          apiKey: '',
          baseUrl: defaults.baseUrl,
          modelId: defaults.modelId,
          anthropicVersion: defaults.anthropicVersion,
          catalogMode: 'provider-native',
          catalogBaseUrl: ''
        },
        errors: {},
        noticeMessage: null
      }
    }

    case 'applyPreset': {
      const data = { ...state.data, ...action.preset, apiKey: '' }
      return {
        ...state,
        status: 'editing',
        data,
        keyScope: action.preset.hasApiKey ? { provider: data.provider, baseUrl: data.baseUrl } : state.keyScope,
        showApiKey: false,
        errors: {},
        noticeMessage: 'Loaded local development preset. Click "Save Configuration" to apply.'
      }
    }

    case 'toggleShowApiKey': {
      return {
        ...state,
        showApiKey: !state.showApiKey
      }
    }

    case 'clearApiKey': {
      return {
        ...state,
        status: 'editing',
        data: {
          ...state.data,
          apiKey: '',
          hasApiKey: false
        },
        keyScope: null,
        showApiKey: false,
        noticeMessage: 'API Key cleared from memory.'
      }
    }

    case 'validationFailed': {
      return {
        ...state,
        status: 'invalid',
        errors: action.errors,
        noticeMessage: null
      }
    }

    case 'saveSuccess': {
      return {
        ...state,
        status: 'saved-in-memory',
        errors: {},
        noticeMessage: action.message
      }
    }

    case 'configurationSaved': {
      return {
        ...state,
        data: {
          ...state.data,
          // Drop the submitted secret, but preserve any newer replacement draft.
          apiKey: state.data.apiKey === action.data.apiKey ? '' : state.data.apiKey,
          hasApiKey: true
        },
        keyScope: { provider: action.data.provider, baseUrl: action.data.baseUrl },
        showApiKey: false,
        status: 'saved-in-memory',
        errors: {},
        noticeMessage: 'Settings saved for this application session. API Key 已配置，切换页面不会清除。'
      }
    }

    case 'testConnectionResult': {
      return {
        ...state,
        status: 'not-connected',
        noticeMessage: action.message
      }
    }

    case 'resetForm': {
      return {
        data: action.data,
        keyScope: action.data.hasApiKey ? { provider: action.data.provider, baseUrl: action.data.baseUrl } : null,
        status: 'pristine',
        errors: {},
        noticeMessage: null,
        showApiKey: false
      }
    }

    default:
      return state
  }
}
