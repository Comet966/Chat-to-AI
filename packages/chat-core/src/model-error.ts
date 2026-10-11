import type { ChatPublicError } from 'chat-contracts'

export function toPublicModelError(error: unknown, aborted = false): ChatPublicError {
  const value = error && typeof error === 'object'
    ? error as { name?: string; code?: string; status?: number; statusCode?: number; cause?: { code?: string } }
    : {}
  if (aborted || value.name === 'AbortError') return { code: 'REQUEST_ABORTED', message: 'Model request was aborted', retryable: true }
  if (value.code === 'UNSUPPORTED_CAPABILITY') return { code: 'UNSUPPORTED_CAPABILITY', message: 'The provider does not support the requested input or operation', retryable: false }
  if (value.code === 'INVALID_REQUEST') return { code: 'INVALID_REQUEST', message: 'Invalid model input', retryable: false }
  if (value.code === 'INVALID_RESPONSE') return { code: 'INVALID_RESPONSE', message: 'Provider returned invalid or empty data', retryable: false }
  const status = value.status ?? value.statusCode
  if (status === 401 || status === 403) return { code: 'PROVIDER_UNAUTHORIZED', message: 'Model provider authentication failed', retryable: false }
  if (status === 429) return { code: 'PROVIDER_RATE_LIMITED', message: 'Model provider rate limit exceeded', retryable: true }
  if (status && status >= 500 && status < 600) return { code: 'PROVIDER_UNAVAILABLE', message: 'Model provider service is temporarily unavailable', retryable: true }
  if (status && status >= 400 && status < 500) return { code: 'INVALID_REQUEST', message: 'Model provider rejected the request', retryable: false }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(value.code ?? value.cause?.code ?? '')) {
    return { code: 'PROVIDER_UNAVAILABLE', message: 'Network connection to model provider failed', retryable: true }
  }
  return { code: 'UNKNOWN', message: 'An unexpected error occurred while generating the model response', retryable: true }
}
