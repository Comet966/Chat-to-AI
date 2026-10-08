import React, { useMemo } from 'react'
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { SandboxedHtmlPreview } from './SandboxedHtmlPreview.js'

export type MessageRenderMode = 'markdown' | 'html'

export interface MessageContentProps {
  content: string
  role: 'user' | 'assistant'
  renderMode: MessageRenderMode
  declaredOutputFormat?: 'markdown' | 'html'
}

export const FORBIDDEN_HTML_TAGS: readonly string[] = Object.freeze([
  'applet',
  'audio',
  'base',
  'button',
  'canvas',
  'dialog',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'img',
  'input',
  'link',
  'meta',
  'object',
  'optgroup',
  'option',
  'picture',
  'script',
  'select',
  'source',
  'style',
  'textarea',
  'track',
  'video'
])

/**
 * Deliberately small, declarative HTML component vocabulary. Model output may
 * compose these elements, but cannot create executable/custom components.
 */
export const ALLOWED_HTML_TAGS: readonly string[] = Object.freeze([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'kbd',
  'li',
  'mark',
  'meter',
  'ol',
  'p',
  'pre',
  'progress',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var'
])

export const ALLOWED_SVG_TAGS: readonly string[] = Object.freeze([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'defs',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'marker'
])

export const FORBIDDEN_SVG_TAGS: readonly string[] = Object.freeze([
  'animate',
  'animateMotion',
  'animateTransform',
  'cursor',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  'filter',
  'font',
  'font-face',
  'foreignObject',
  'glyph',
  'hkern',
  'image',
  'missing-glyph',
  'pattern',
  'script',
  'set',
  'style',
  'use',
  'view',
  'vkern'
])

export const FORBIDDEN_HTML_ATTRS: readonly string[] = Object.freeze([
  'action',
  'formaction',
  'href',
  'src',
  'style',
  'target',
  'xlink:href'
])

export const ALLOWED_HTML_ATTRS: readonly string[] = Object.freeze([
  'aria-label',
  'aria-hidden',
  'colspan',
  'datetime',
  'high',
  'low',
  'max',
  'min',
  'open',
  'optimum',
  'reversed',
  'role',
  'rowspan',
  'scope',
  'start',
  'title',
  'value'
])

export const ALLOWED_SVG_ATTRS: readonly string[] = Object.freeze([
  'aria-label',
  'aria-hidden',
  'clip-path',
  'cx',
  'cy',
  'd',
  'dominant-baseline',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'gradientTransform',
  'gradientUnits',
  'height',
  'id',
  'marker-end',
  'marker-mid',
  'marker-start',
  'markerHeight',
  'markerUnits',
  'markerWidth',
  'mask',
  'offset',
  'opacity',
  'orient',
  'pathLength',
  'points',
  'preserveAspectRatio',
  'r',
  'refX',
  'refY',
  'role',
  'rx',
  'ry',
  'spreadMethod',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'transform',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2'
])

/** Resource limits prevent a valid-but-hostile inline SVG from monopolising the renderer. */
export const MAX_SVG_SOURCE_LENGTH = 30_000
export const MAX_SVG_COUNT = 8
export const MAX_SVG_NODE_COUNT = 256
export const MAX_TOTAL_SVG_NODE_COUNT = 512
export const MAX_SVG_ATTRIBUTE_LENGTH = 2_048
export const MAX_SVG_VIEWBOX_DIMENSION = 100_000
export const MAX_PLAIN_TEXT_FALLBACK_LENGTH = 30_000

export const ASSISTANT_HTML_SANITIZER_CONFIG = Object.freeze({
  ALLOWED_TAGS: [...ALLOWED_HTML_TAGS],
  ALLOWED_ATTR: [...ALLOWED_HTML_ATTRS],
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [...FORBIDDEN_HTML_TAGS],
  FORBID_ATTR: [...FORBIDDEN_HTML_ATTRS]
})

/**
 * Deliberately separate from the regular HTML profile.  It is selected only
 * for content containing an inline SVG and keeps the SVG allowlist narrow.
 */
export const ASSISTANT_SVG_SANITIZER_CONFIG = Object.freeze({
  ALLOWED_TAGS: [...ALLOWED_HTML_TAGS, ...ALLOWED_SVG_TAGS],
  ALLOWED_ATTR: [...ALLOWED_HTML_ATTRS, ...ALLOWED_SVG_ATTRS],
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [...new Set([...FORBIDDEN_HTML_TAGS, ...FORBIDDEN_SVG_TAGS])],
  FORBID_ATTR: [...FORBIDDEN_HTML_ATTRS]
})

interface HtmlRenderResult {
  readonly sanitizedHtml: string
  readonly rejectedSvg: boolean
  readonly removedActiveContent: boolean
  readonly hasInteractiveContent: boolean
}

function hasUnsafeOrOversizedSvg(content: string, sanitizedHtml: string): boolean {
  if (!/<\s*svg\b/i.test(content)) return false

  const document = new DOMParser().parseFromString(sanitizedHtml, 'text/html')
  const svgs = [...document.querySelectorAll('svg')]
  const rawSvgCount = content.match(/<\s*svg\b/gi)?.length ?? 0
  if (svgs.length === 0 || svgs.length !== rawSvgCount || svgs.length > MAX_SVG_COUNT) return true

  const totalSvgNodeCount = svgs.reduce(
    (count, svg) => count + svg.querySelectorAll('*').length + 1,
    0
  )
  if (totalSvgNodeCount > MAX_TOTAL_SVG_NODE_COUNT) return true

  for (const svg of svgs) {
    if (svg.outerHTML.length > MAX_SVG_SOURCE_LENGTH) return true
    if (svg.querySelectorAll('*').length + 1 > MAX_SVG_NODE_COUNT) return true

    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.value.length > MAX_SVG_ATTRIBUTE_LENGTH) return true
        // Paint servers, markers, masks, and clipping paths may only reference
        // definitions inside the same sanitized SVG. External CSS URLs can
        // otherwise turn a static diagram into a resource-loading surface.
        if (
          /url\s*\(/i.test(attribute.value) &&
          !/^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(attribute.value)
        ) {
          return true
        }
      }
    }

    const viewBox = svg.getAttribute('viewBox')
    if (viewBox) {
      const values = viewBox.trim().split(/[\s,]+/).map(Number)
      if (
        values.length !== 4 ||
        values.some((value) => !Number.isFinite(value)) ||
        Math.abs(values[2]) > MAX_SVG_VIEWBOX_DIMENSION ||
        Math.abs(values[3]) > MAX_SVG_VIEWBOX_DIMENSION
      ) {
        return true
      }
    }
  }

  return false
}

function containsActiveContent(content: string): boolean {
  return (
    /<\s*\/?\s*(?:script|style|iframe|frame|frameset|object|embed|applet|form|input|button|select|textarea|canvas)\b/i.test(content) ||
    /<\s*\/?\s*[a-z][\w]*-[\w-]+\b/i.test(content) ||
    /\son[a-z][\w:-]*\s*=/i.test(content) ||
    /(?:javascript|vbscript)\s*:/i.test(content)
  )
}

function containsInteractiveContent(content: string): boolean {
  return (
    /<\s*script\b/i.test(content) ||
    /\son[a-z][\w:-]*\s*=/i.test(content) ||
    /<\s*\/?\s*(?:button|input|select|textarea|canvas|form)\b/i.test(content) ||
    /<\s*\/?\s*[a-z][\w]*-[\w-]+\b/i.test(content)
  )
}

function sanitizeHtmlForRendering(content: string): HtmlRenderResult {
  try {
    const hasSvg = /<\s*svg\b/i.test(content)
    const sanitizedHtml = DOMPurify.sanitize(
      content,
      hasSvg ? ASSISTANT_SVG_SANITIZER_CONFIG : ASSISTANT_HTML_SANITIZER_CONFIG
    )
    return {
      sanitizedHtml,
      rejectedSvg: hasUnsafeOrOversizedSvg(content, sanitizedHtml),
      removedActiveContent: containsActiveContent(content),
      hasInteractiveContent: containsInteractiveContent(content)
    }
  } catch {
    return {
      sanitizedHtml: '',
      rejectedSvg: /<\s*svg\b/i.test(content),
      removedActiveContent: containsActiveContent(content),
      hasInteractiveContent: containsInteractiveContent(content)
    }
  }
}

export function sanitizeAssistantHtml(content: string): string {
  return sanitizeHtmlForRendering(content).sanitizedHtml
}

const markdownPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [[rehypeKatex, { throwOnError: false, strict: false }]] as any

const markdownComponents = {
  a: ({ node, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
    <a {...props} onClick={(e) => e.preventDefault()} />
  )
}

interface HtmlMessageSegment {
  readonly kind: 'html' | 'markdown'
  readonly content: string
}

/**
 * Models occasionally wrap an HTML answer in a Markdown fence and add an
 * explanation around it. Keep that explanation out of the HTML document and
 * never send fence markers to the sandbox.
 */
function splitHtmlMessage(content: string): HtmlMessageSegment[] {
  const fence = /(^|\n)```(?:html|htm)[ \t]*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/gi
  const segments: HtmlMessageSegment[] = []
  let cursor = 0

  for (const match of content.matchAll(fence)) {
    const start = match.index ?? 0
    const markdown = content.slice(cursor, start).trim()
    if (markdown) segments.push({ kind: 'markdown', content: markdown })
    segments.push({ kind: 'html', content: match[2] ?? '' })
    cursor = start + match[0].length
  }

  if (segments.length === 0) {
    // During streaming, an unclosed HTML fence is source text, not a partial
    // HTML document to sanitize or execute.
    if (/(^|\n)```(?:html|htm)\b/i.test(content)) {
      return [{ kind: 'markdown', content }]
    }
    // An HTML-declared answer can still contain plain explanatory Markdown.
    // Preserve its paragraphs and lists instead of collapsing them as HTML text.
    if (!/<\s*\/?\s*[a-z][\w:-]*(?:\s|\/?>)/i.test(content)) {
      return [{ kind: 'markdown', content }]
    }
    const htmlLine = content.search(/(^|\n)[ \t]*<(?:!doctype\b|[a-z][\w:-]*(?:\s|\/?>))/i)
    if (htmlLine > 0) {
      const explanation = content.slice(0, htmlLine).trim()
      if (explanation && !/<\s*\/?\s*[a-z][\w:-]*(?:\s|\/?>)/i.test(explanation)) {
        return [
          { kind: 'markdown', content: explanation },
          { kind: 'html', content: content.slice(htmlLine).trim() }
        ]
      }
    }
    return [{ kind: 'html', content }]
  }

  const trailing = content.slice(cursor).trim()
  if (trailing) segments.push({ kind: 'markdown', content: trailing })
  return segments
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="message-content message-content-rendered message-content-markdown">
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function SanitizedHtmlContent({ content }: { content: string }) {
  const result = useMemo(() => sanitizeHtmlForRendering(content), [content])

  if (result.rejectedSvg) {
    const truncated = content.slice(0, MAX_PLAIN_TEXT_FALLBACK_LENGTH)
    return (
      <div className="message-content message-content-plain message-content-svg-fallback">
        <p role="status">SVG 内容不符合安全或资源限制，已按纯文本显示。</p>
        {truncated}
        {content.length > truncated.length ? '\n…（内容已截断）' : ''}
      </div>
    )
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement | null)?.closest('a')
    if (target) {
      event.preventDefault()
    }
  }

  return (
    <div className="message-content-html-container">
      {result.removedActiveContent && (
        <p className="message-content-security-notice" role="status">
          {result.hasInteractiveContent
            ? '交互内容仅在隔离沙箱中显示；点击下方按钮后才会运行。'
            : '主对话区已移除不安全的 HTML 内容。'}
        </p>
      )}
      {!result.hasInteractiveContent && (
        <div
          className="message-content message-content-rendered message-content-html"
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: result.sanitizedHtml }}
        />
      )}
      {result.hasInteractiveContent && <SandboxedHtmlPreview content={content} />}
      {result.hasInteractiveContent && (
        <details className="message-content-html-source">
          <summary>查看 HTML 源码</summary>
          <pre><code>{content}</code></pre>
        </details>
      )}
    </div>
  )
}

function HtmlMessageContent({ content }: { content: string }) {
  const segments = useMemo(() => splitHtmlMessage(content), [content])
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'html' ? (
          <SanitizedHtmlContent key={index} content={segment.content} />
        ) : (
          <MarkdownContent key={index} content={segment.content} />
        )
      )}
    </>
  )
}

export const MessageContent = React.memo(function MessageContent({
  content,
  role,
  renderMode,
  declaredOutputFormat
}: MessageContentProps) {
  if (role === 'user') {
    return <div className="message-content message-content-plain">{content}</div>
  }

  // Completed assistant turns are rendered with their Main-owned, frozen
  // format declaration.  A mutable global preference must not silently turn
  // an old Markdown response into HTML (or the reverse).
  const effectiveRenderMode = declaredOutputFormat ?? renderMode

  if (effectiveRenderMode === 'html') {
    return <HtmlMessageContent content={content} />
  }

  return <MarkdownContent content={content} />
})
