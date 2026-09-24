export const BROWSER_WINDOW_SECURITY_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false
} as const

export function buildContentSecurityPolicy(rendererUrl: URL | null): string {
  const isDev =
    rendererUrl !== null &&
    (rendererUrl.protocol === 'http:' || rendererUrl.protocol === 'https:')
  const websocketProtocol = rendererUrl?.protocol === 'https:' ? 'wss:' : 'ws:'
  const devConnectSources = isDev
    ? ` ${rendererUrl.origin} ${websocketProtocol}//${rendererUrl.host}`
    : ''

  return isDev
    ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${devConnectSources}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
    : `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
}
