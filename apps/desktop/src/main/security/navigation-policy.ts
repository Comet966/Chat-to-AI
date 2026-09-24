export class NavigationPolicy {
  constructor(private readonly allowedRendererUrl: URL | null) {}

  public isAllowedNavigation(navigationUrl: string): boolean {
    if (!this.allowedRendererUrl) {
      return false
    }

    try {
      const targetUrl = new URL(navigationUrl)
      if (this.allowedRendererUrl.protocol === 'file:') {
        return targetUrl.protocol === 'file:' && targetUrl.pathname === this.allowedRendererUrl.pathname
      }
      return targetUrl.origin === this.allowedRendererUrl.origin
    } catch {
      return false
    }
  }
}
