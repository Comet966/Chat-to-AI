/** Browser-safe identity for UI indications; Main independently validates credentials. */
export function normalizedProviderEndpoint(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch { return null }
}
