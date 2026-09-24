import React, { useReducer } from 'react'
import { Button } from '../../components/Button.js'
import { Field } from '../../components/Field.js'
import { StatusNotice } from '../../components/StatusNotice.js'
import type {
  ProviderKind,
  ProviderSettingsData,
  ProviderSettingsPort
} from '../../ports/provider-settings.port.js'
import { providerSettingsReducer } from './provider-settings.reducer.js'
import type { ProviderSettingsFormState } from './provider-settings.types.js'

export interface ProviderSettingsFormProps {
  port: ProviderSettingsPort
  initialData: ProviderSettingsData
}

export function ProviderSettingsForm({
  port,
  initialData
}: ProviderSettingsFormProps) {
  const [state, dispatch] = useReducer(providerSettingsReducer, {
    data: initialData,
    status: 'pristine',
    errors: {},
    noticeMessage: null,
    showApiKey: false
  } as ProviderSettingsFormState)

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({
      type: 'providerChanged',
      provider: e.target.value as ProviderKind
    })
  }

  const handleFieldChange = (
    field: keyof ProviderSettingsData,
    value: string | number
  ) => {
    dispatch({ type: 'fieldChanged', field, value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const errors: Partial<Record<keyof ProviderSettingsData, string>> = {}
    if (!state.data.baseUrl || !/^https?:\/\/.+/.test(state.data.baseUrl)) {
      errors.baseUrl = 'Please enter a valid HTTP/HTTPS URL'
    }
    if (!state.data.modelId || state.data.modelId.trim() === '') {
      errors.modelId = 'Model ID is required'
    }
    if (
      !state.data.maxOutputTokens ||
      state.data.maxOutputTokens <= 0 ||
      !Number.isInteger(Number(state.data.maxOutputTokens))
    ) {
      errors.maxOutputTokens = 'Max output tokens must be a positive integer'
    }

    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'validationFailed', errors })
      return
    }

    const saveRes = await port.saveSettings({
      ...state.data,
      maxOutputTokens: Number(state.data.maxOutputTokens)
    })

    if (saveRes.ok) {
      dispatch({
        type: 'saveSuccess',
        message: 'Settings saved in memory (valid only for this UI preview session).'
      })
    } else {
      dispatch({
        type: 'validationFailed',
        errors: {
          [saveRes.error.field as keyof ProviderSettingsData ?? 'baseUrl']: saveRes.error.message
        }
      })
    }
  }

  const handleTestConnection = async () => {
    const res = await port.testConnection()
    if (!res.ok) {
      dispatch({
        type: 'testConnectionResult',
        message: res.error.message
      })
    }
  }

  const handleClearKey = async () => {
    await port.clearKey()
    dispatch({ type: 'clearApiKey' })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <h2 className="card-title">
        Provider Configuration
      </h2>

      {state.noticeMessage && (
        <StatusNotice
          type={
            state.status === 'saved-in-memory'
              ? 'success'
              : state.status === 'not-connected'
                ? 'warning'
                : 'info'
          }
          message={state.noticeMessage}
        />
      )}

      <Field label="Provider" htmlFor="provider" error={state.errors.provider}>
        <select
          id="provider"
          value={state.data.provider}
          onChange={handleProviderChange}
          className="field-select"
        >
          <option value="openai-compatible">OpenAI Compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Google Gemini</option>
        </select>
      </Field>

      <Field
        label="Base URL"
        htmlFor="baseUrl"
        error={state.errors.baseUrl}
        hint="Root API endpoint for this provider"
      >
        <input
          id="baseUrl"
          type="url"
          value={state.data.baseUrl}
          onChange={(e) => handleFieldChange('baseUrl', e.target.value)}
          className="field-input"
          placeholder="https://api.example.com/v1"
          aria-invalid={Boolean(state.errors.baseUrl)}
          aria-describedby={state.errors.baseUrl ? 'baseUrl-error' : undefined}
        />
      </Field>

      <Field
        label="API Key"
        htmlFor="apiKey"
        error={state.errors.apiKey}
        hint="Stored strictly in memory for this preview; never saved to disk"
      >
        <div className="api-key-input-row">
          <input
            id="apiKey"
            type={state.showApiKey ? 'text' : 'password'}
            value={state.data.apiKey}
            onChange={(e) => handleFieldChange('apiKey', e.target.value)}
            className="field-input api-key-input"
            placeholder="Enter API Key..."
            aria-invalid={Boolean(state.errors.apiKey)}
            aria-describedby={state.errors.apiKey ? 'apiKey-error' : undefined}
          />
          <Button
            variant="secondary"
            onClick={() => dispatch({ type: 'toggleShowApiKey' })}
            aria-label={state.showApiKey ? 'Hide API key' : 'Show API key'}
          >
            {state.showApiKey ? 'Hide' : 'Show'}
          </Button>
          <Button
            variant="danger"
            onClick={handleClearKey}
            disabled={!state.data.apiKey}
            aria-label="Clear API key"
          >
            Clear
          </Button>
        </div>
      </Field>

      <Field label="Model ID" htmlFor="modelId" error={state.errors.modelId}>
        <input
          id="modelId"
          type="text"
          value={state.data.modelId}
          onChange={(e) => handleFieldChange('modelId', e.target.value)}
          className="field-input"
          placeholder="e.g. gpt-4o, claude-3-5-sonnet"
          aria-invalid={Boolean(state.errors.modelId)}
          aria-describedby={state.errors.modelId ? 'modelId-error' : undefined}
        />
      </Field>

      <Field
        label="Max Output Tokens"
        htmlFor="maxOutputTokens"
        error={state.errors.maxOutputTokens}
      >
        <input
          id="maxOutputTokens"
          type="number"
          min={1}
          value={state.data.maxOutputTokens}
          onChange={(e) => handleFieldChange('maxOutputTokens', Number(e.target.value))}
          className="field-input"
          aria-invalid={Boolean(state.errors.maxOutputTokens)}
          aria-describedby={state.errors.maxOutputTokens ? 'maxOutputTokens-error' : undefined}
        />
      </Field>

      {state.data.provider === 'anthropic' && (
        <Field
          label="Anthropic Version"
          htmlFor="anthropicVersion"
          error={state.errors.anthropicVersion}
        >
          <input
            id="anthropicVersion"
            type="text"
            value={state.data.anthropicVersion ?? '2023-06-01'}
            onChange={(e) => handleFieldChange('anthropicVersion', e.target.value)}
            className="field-input"
          />
        </Field>
      )}

      <div className="form-actions">
        <Button type="submit" variant="primary">
          Save Configuration
        </Button>
        <Button type="button" variant="secondary" onClick={handleTestConnection}>
          Test Connection
        </Button>
      </div>
    </form>
  )
}
