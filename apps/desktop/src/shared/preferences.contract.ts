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
  'You must output only safe HTML fragments. Do not wrap the response in <html>, <head>, or <body> tags. Do not use Markdown syntax. Do not output <script>, <style>, <iframe>, <form>, or external resources. When diagrams or illustrations are needed, use safe inline <svg> elements. If requirements cannot be met, output plain text.'

export const DEFAULT_GENERATION_PREFERENCES: GenerationPreferencesDto = Object.freeze({
  activeFormat: 'markdown',
  markdownTemplate: DEFAULT_MARKDOWN_TEMPLATE,
  htmlTemplate: DEFAULT_HTML_TEMPLATE,
  version: 1
})
