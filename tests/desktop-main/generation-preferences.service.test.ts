import { describe, expect, it } from 'vitest'
import { GenerationPreferencesService } from '../../apps/desktop/src/main/preferences/generation-preferences.service.js'
import {
  DEFAULT_GENERATION_PREFERENCES,
  DEFAULT_HTML_TEMPLATE
} from '../../apps/desktop/src/shared/preferences.contract.js'

describe('GenerationPreferencesService', () => {
  it('returns default preferences initialized with version 1 and markdown format', () => {
    const service = new GenerationPreferencesService()
    const result = service.getPreferences()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.activeFormat).toBe('markdown')
    expect(result.value.version).toBe(1)
    expect(result.value.markdownTemplate).toBe(DEFAULT_GENERATION_PREFERENCES.markdownTemplate)
    expect(result.value.htmlTemplate).toBe(DEFAULT_GENERATION_PREFERENCES.htmlTemplate)
  })

  it('describes the safe static HTML, component, SVG, and JavaScript policy', () => {
    expect(DEFAULT_HTML_TEMPLATE).toContain('details/summary')
    expect(DEFAULT_HTML_TEMPLATE).toContain('inline <svg>')
    expect(DEFAULT_HTML_TEMPLATE).toContain('explicitly requests behavior that requires JavaScript')
    expect(DEFAULT_HTML_TEMPLATE).toContain('opaque-origin sandbox')
    expect(DEFAULT_HTML_TEMPLATE).toContain('HTML-escape it inside <pre><code>')
    expect(DEFAULT_HTML_TEMPLATE).toContain('do not use image, use, foreignObject')
  })

  it('saves valid generation preferences and increments version', () => {
    const service = new GenerationPreferencesService()

    const saveRes = service.savePreferences({
      activeFormat: 'html',
      markdownTemplate: 'Custom Markdown template with at least ten characters.',
      htmlTemplate: 'Custom HTML template with at least ten characters.'
    })

    expect(saveRes.ok).toBe(true)

    const updated = service.getPreferences()
    expect(updated.ok).toBe(true)
    if (!updated.ok) return

    expect(updated.value.activeFormat).toBe('html')
    expect(updated.value.version).toBe(2)
    expect(updated.value.markdownTemplate).toBe(
      'Custom Markdown template with at least ten characters.'
    )
    expect(updated.value.htmlTemplate).toBe('Custom HTML template with at least ten characters.')
  })

  it('rejects templates that are too short (< 10 chars)', () => {
    const service = new GenerationPreferencesService()

    const saveRes = service.savePreferences({
      activeFormat: 'markdown',
      markdownTemplate: 'Too short',
      htmlTemplate: 'Valid template with enough characters.'
    })

    expect(saveRes.ok).toBe(false)
    if (!saveRes.ok) {
      expect(saveRes.error.code).toBe('VALIDATION_FAILED')
      expect(saveRes.error.field).toBe('markdownTemplate')
    }
  })

  it('rejects templates exceeding maximum length (> 4000 chars)', () => {
    const service = new GenerationPreferencesService()

    const saveRes = service.savePreferences({
      activeFormat: 'markdown',
      markdownTemplate: 'a'.repeat(4001),
      htmlTemplate: 'Valid template with enough characters.'
    })

    expect(saveRes.ok).toBe(false)
    if (!saveRes.ok) {
      expect(saveRes.error.code).toBe('VALIDATION_FAILED')
      expect(saveRes.error.field).toBe('markdownTemplate')
    }
  })

  it('updates only active format when requested', () => {
    const service = new GenerationPreferencesService()

    const formatRes = service.setActiveFormat('html')
    expect(formatRes.ok).toBe(true)

    const prefs = service.getPreferences()
    if (!prefs.ok) return
    expect(prefs.value.activeFormat).toBe('html')
  })

  it('resets to default templates while preserving version increment', () => {
    const service = new GenerationPreferencesService()

    service.savePreferences({
      activeFormat: 'html',
      markdownTemplate: 'Edited Markdown template text.',
      htmlTemplate: 'Edited HTML template text.'
    })

    const resetRes = service.resetToDefault()
    expect(resetRes.ok).toBe(true)

    const prefs = service.getPreferences()
    if (!prefs.ok) return
    expect(prefs.value.activeFormat).toBe('markdown')
    expect(prefs.value.markdownTemplate).toBe(DEFAULT_GENERATION_PREFERENCES.markdownTemplate)
    expect(prefs.value.version).toBe(3)
  })
})
