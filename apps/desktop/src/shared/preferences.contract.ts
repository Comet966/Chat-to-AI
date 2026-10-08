export type OutputFormat = 'markdown' | 'html'

export interface GenerationPreferencesDto {
  readonly activeFormat: OutputFormat
  readonly markdownTemplate: string
  readonly htmlTemplate: string
  readonly version: number
}

export interface SaveGenerationPreferencesInput {
  readonly activeFormat: OutputFormat
  readonly markdownTemplate: string
  readonly htmlTemplate: string
}

export interface SetActiveFormatInput {
  readonly format: OutputFormat
}

export type DesktopPreferencesErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED_SENDER'
  | 'INTERNAL_ERROR'

export interface DesktopPreferencesError {
  readonly code: DesktopPreferencesErrorCode
  readonly message: string
  readonly field?: string
}

export type DesktopPreferencesResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DesktopPreferencesError }

export const DEFAULT_MARKDOWN_TEMPLATE =
  'You must output only standard CommonMark/GFM Markdown. Do not output raw HTML tags (e.g. <div>, <span>, <button>, <script>). Write mathematical formulas using $...$ for inline math and $$...$$ for block math. Format code using fenced code blocks with language identifiers. Do not output SVG, iframe, or external resources.'

export const DEFAULT_HTML_TEMPLATE =
  'Output only one self-contained HTML fragment; never wrap it in <html>, <head>, or <body>, and never mix in Markdown syntax. Prefer static semantic components using headings, paragraphs, strong/emphasis, lists, blockquotes, pre/code, tables, figure/figcaption, details/summary, progress, and meter. For diagrams, use inline <svg> with a viewBox and static shapes, paths, text, groups, gradients, clipping paths, masks, and markers; do not use image, use, foreignObject, animation, filters, href, or external/data URLs, and include accessible <title>/<desc>. Only when the user explicitly requests behavior that requires JavaScript, include the controls plus a small bounded inline <script>; it will be removed from the main conversation DOM and can run only after the user clicks Run in an opaque-origin sandbox. Sandbox scripts must be fully self-contained and must not use imports, fetch, XMLHttpRequest, WebSocket, EventSource, workers, storage, eval, new Function, navigation, popups, downloads, clipboard, device APIs, external resources, or unbounded loops/timers. Do not use iframe, embedded objects, media, remote fonts, or external stylesheets. If JavaScript is requested as source code rather than as a runnable demo, HTML-escape it inside <pre><code> instead of emitting an executable script.'

export const DEFAULT_GENERATION_PREFERENCES: GenerationPreferencesDto = Object.freeze({
  activeFormat: 'markdown',
  markdownTemplate: DEFAULT_MARKDOWN_TEMPLATE,
  htmlTemplate: DEFAULT_HTML_TEMPLATE,
  version: 1
})
