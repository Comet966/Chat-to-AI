import type { ProviderKind, ProviderSettingsData } from '../../ports/provider-settings.port.js'
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
    baseUrl: 'https://api.anthropic.com/v1',
    modelId: 'claude-3-5-sonnet-20241022',
    anthropicVersion: '2023-06-01'
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-1.5-pro'
  }
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
          baseUrl: defaults.baseUrl,
          modelId: defaults.modelId,
          anthropicVersion: defaults.anthropicVersion
        },
        errors: {},
        noticeMessage: null
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
          apiKey: ''
        },
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
