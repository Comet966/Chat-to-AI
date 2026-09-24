import { describe, expect, it } from 'vitest'
import { NavigationPolicy } from '../../apps/desktop/src/main/security/navigation-policy.js'
import {
  BROWSER_WINDOW_SECURITY_PREFERENCES,
  buildContentSecurityPolicy
} from '../../apps/desktop/src/main/security/security-policy.js'

describe('Security Policies and Isolation Controls', () => {
  describe('BrowserWindow Security Preferences', () => {
    it('enforces strict webPreferences isolation defaults', () => {
      expect(BROWSER_WINDOW_SECURITY_PREFERENCES.contextIsolation).toBe(true)
      expect(BROWSER_WINDOW_SECURITY_PREFERENCES.nodeIntegration).toBe(false)
      expect(BROWSER_WINDOW_SECURITY_PREFERENCES.sandbox).toBe(true)
      expect(BROWSER_WINDOW_SECURITY_PREFERENCES.webSecurity).toBe(true)
      expect(BROWSER_WINDOW_SECURITY_PREFERENCES.webviewTag).toBe(false)
    })
  })

  describe('Content Security Policy', () => {
    it('generates strict production CSP without unsafe-inline or remote origins', () => {
      const prodCsp = buildContentSecurityPolicy(null)

      expect(prodCsp).toContain("default-src 'self'")
      expect(prodCsp).toContain("script-src 'self'")
      expect(prodCsp).toContain("style-src 'self'")
      expect(prodCsp).toContain("img-src 'self' data:")
      expect(prodCsp).toContain("connect-src 'self'")
      expect(prodCsp).toContain("object-src 'none'")
      expect(prodCsp).toContain("base-uri 'none'")
      expect(prodCsp).toContain("frame-ancestors 'none'")
      expect(prodCsp).toContain("form-action 'none'")

      // Production must NOT contain unsafe directives or remote origins
      expect(prodCsp).not.toContain("'unsafe-inline'")
      expect(prodCsp).not.toContain("'unsafe-eval'")
      expect(prodCsp).not.toContain('http:')
      expect(prodCsp).not.toContain('https:')
    })

    it('generates scoped dev CSP allowing dev server origin and WebSocket protocol', () => {
      const devUrl = new URL('http://localhost:5173')
      const devCsp = buildContentSecurityPolicy(devUrl)

      expect(devCsp).toContain('connect-src')
      expect(devCsp).toContain('http://localhost:5173')
      expect(devCsp).toContain('ws://localhost:5173')
      expect(devCsp).not.toContain('https://malicious.com')
    })
  })

  describe('Navigation Policy', () => {
    it('allows hash routes on the configured file URL', () => {
      const rendererFileUrl = new URL('file:///app/out/renderer/index.html')
      const policy = new NavigationPolicy(rendererFileUrl)

      expect(policy.isAllowedNavigation('file:///app/out/renderer/index.html')).toBe(true)
      expect(policy.isAllowedNavigation('file:///app/out/renderer/index.html#/chat')).toBe(true)
      expect(
        policy.isAllowedNavigation('file:///app/out/renderer/index.html#/settings/providers')
      ).toBe(true)
    })

    it('rejects different file paths and remote origins', () => {
      const rendererFileUrl = new URL('file:///app/out/renderer/index.html')
      const policy = new NavigationPolicy(rendererFileUrl)

      expect(policy.isAllowedNavigation('file:///app/out/untrusted.html')).toBe(false)
      expect(policy.isAllowedNavigation('file:///etc/passwd')).toBe(false)
      expect(policy.isAllowedNavigation('https://example.com')).toBe(false)
      expect(policy.isAllowedNavigation('javascript:alert(1)')).toBe(false)
      expect(policy.isAllowedNavigation('not-a-valid-url')).toBe(false)
    })

    it('allows same-origin navigations for dev server and rejects cross-origin', () => {
      const devUrl = new URL('http://localhost:5173')
      const policy = new NavigationPolicy(devUrl)

      expect(policy.isAllowedNavigation('http://localhost:5173/index.html')).toBe(true)
      expect(policy.isAllowedNavigation('http://localhost:5173/#/chat')).toBe(true)
      expect(policy.isAllowedNavigation('http://localhost:5173/chat')).toBe(true)
      expect(policy.isAllowedNavigation('http://localhost:3000')).toBe(false)
      expect(policy.isAllowedNavigation('https://localhost:5173')).toBe(false)
      expect(policy.isAllowedNavigation('http://evil-localhost.com')).toBe(false)
    })
  })
})
