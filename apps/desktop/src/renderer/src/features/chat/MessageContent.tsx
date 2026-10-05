import React, { useMemo } from 'react'
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

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
  'defs',
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

/** Resource limits prevent a valid-but-hostile inline SVG from monopolising the renderer. */
export const MAX_SVG_SOURCE_LENGTH = 30_000
export const MAX_SVG_NODE_COUNT = 256
export const MAX_SVG_ATTRIBUTE_LENGTH = 2_048
export const MAX_SVG_VIEWBOX_DIMENSION = 100_000
export const MAX_PLAIN_TEXT_FALLBACK_LENGTH = 30_000

export const ASSISTANT_HTML_SANITIZER_CONFIG = Object.freeze({
  USE_PROFILES: { html: true },
  FORBID_TAGS: [...FORBIDDEN_HTML_TAGS],
  FORBID_ATTR: [...FORBIDDEN_HTML_ATTRS]
})

/**
 * Deliberately separate from the regular HTML profile.  It is selected only
 * for content containing an inline SVG and keeps the SVG allowlist narrow.
 */
export const ASSISTANT_SVG_SANITIZER_CONFIG = Object.freeze({
  USE_PROFILES: { html: true, svg: true },
  ADD_TAGS: [...ALLOWED_SVG_TAGS],
  FORBID_TAGS: [...new Set([...FORBIDDEN_HTML_TAGS, ...FORBIDDEN_SVG_TAGS])],
  FORBID_ATTR: [...FORBIDDEN_HTML_ATTRS]
})

interface HtmlRenderResult {
  readonly sanitizedHtml: string
  readonly rejectedSvg: boolean
}

function hasUnsafeOrOversizedSvg(content: string, sanitizedHtml: string): boolean {
  if (!/<\s*svg\b/i.test(content)) return false
  if (content.length > MAX_SVG_SOURCE_LENGTH) return true

  const document = new DOMParser().parseFromString(sanitizedHtml, 'text/html')
  const svgs = [...document.querySelectorAll('svg')]
  if (svgs.length !== 1) return true

  const svg = svgs[0]
  if (svg.outerHTML.length > MAX_SVG_SOURCE_LENGTH) return true
  if (svg.querySelectorAll('*').length + 1 > MAX_SVG_NODE_COUNT) return true

  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.value.length > MAX_SVG_ATTRIBUTE_LENGTH) return true
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

  return false
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
      rejectedSvg: hasUnsafeOrOversizedSvg(content, sanitizedHtml)
    }
  } catch {
    return { sanitizedHtml: '', rejectedSvg: /<\s*svg\b/i.test(content) }
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
    <div
      className="message-content message-content-rendered message-content-html"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: result.sanitizedHtml }}
    />
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
    return <SanitizedHtmlContent content={content} />
  }

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
})
