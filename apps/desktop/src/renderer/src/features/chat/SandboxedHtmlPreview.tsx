import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/Button.js'

export const MAX_INTERACTIVE_HTML_LENGTH = 100_000
export const MAX_INTERACTIVE_SCRIPT_COUNT = 4
export const MAX_INTERACTIVE_SCRIPT_LENGTH = 30_000

const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'"
].join('; ')

const SANDBOX_BOOTSTRAP = `
<script>
(() => {
  'use strict';
  const deny = () => Promise.reject(new Error('Network access is disabled in the HTML preview sandbox.'));
  const denyConstructor = function () { throw new Error('This API is disabled in the HTML preview sandbox.'); };
  try { delete globalThis.desktopApi; } catch {}
  try { Object.defineProperty(globalThis, 'fetch', { value: deny, configurable: false }); } catch {}
  try { Object.defineProperty(globalThis, 'XMLHttpRequest', { value: denyConstructor, configurable: false }); } catch {}
  try { Object.defineProperty(globalThis, 'WebSocket', { value: denyConstructor, configurable: false }); } catch {}
  try { Object.defineProperty(globalThis, 'EventSource', { value: denyConstructor, configurable: false }); } catch {}
  try { Object.defineProperty(globalThis, 'Worker', { value: denyConstructor, configurable: false }); } catch {}
  try { Object.defineProperty(globalThis, 'SharedWorker', { value: denyConstructor, configurable: false }); } catch {}
  try { Object.defineProperty(globalThis, 'open', { value: () => null, configurable: false }); } catch {}
  try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: false }); } catch {}
  addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a[href]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
</script>`

const SANDBOX_BASE_STYLES = `
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; line-height: 1.5; overflow-wrap: anywhere; }
  pre { max-width: 100%; overflow: auto; padding: 12px; border: 1px solid #8886; border-radius: 8px; }
  table { max-width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border: 1px solid #8888; }
  svg, canvas { display: block; max-width: 100%; height: auto; }
</style>`

const REMOVED_SANDBOX_TAGS = [
  'applet',
  'audio',
  'base',
  'embed',
  'frame',
  'frameset',
  'iframe',
  'link',
  'meta',
  'object',
  'picture',
  'source',
  'track',
  'video'
].join(',')

const REMOVED_URL_ATTRIBUTES = [
  'action',
  'formaction',
  'href',
  'poster',
  'src',
  'srcset',
  'target',
  'xlink:href'
]

export type SandboxedDocumentResult =
  | { readonly ok: true; readonly documentHtml: string }
  | { readonly ok: false; readonly message: string }

/**
 * Builds an isolated document, never markup for the parent DOM. Executable
 * output is only used as the source of a sandboxed opaque-origin iframe.
 */
export function buildSandboxedHtmlDocument(content: string): SandboxedDocumentResult {
  if (content.length > MAX_INTERACTIVE_HTML_LENGTH) {
    return { ok: false, message: '交互内容过大，无法在隔离沙箱中运行。' }
  }

  const parsed = new DOMParser().parseFromString(content, 'text/html')
  for (const element of parsed.querySelectorAll(REMOVED_SANDBOX_TAGS)) element.remove()

  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of REMOVED_URL_ATTRIBUTES) element.removeAttribute(attribute)
    for (const attribute of [...element.attributes]) {
      if (/url\s*\(/i.test(attribute.value)) element.removeAttribute(attribute.name)
    }
  }

  const scripts = [...parsed.querySelectorAll('script')]
  const scriptLength = scripts.reduce((length, script) => length + (script.textContent?.length ?? 0), 0)
  if (scripts.length > MAX_INTERACTIVE_SCRIPT_COUNT || scriptLength > MAX_INTERACTIVE_SCRIPT_LENGTH) {
    return { ok: false, message: '脚本数量或体积超过隔离沙箱限制。' }
  }

  const headContent = [...parsed.head.children]
    .filter((element) => element.tagName === 'SCRIPT' || element.tagName === 'STYLE')
    .map((element) => element.outerHTML)
    .join('\n')

  return {
    ok: true,
    documentHtml: [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
      '<meta name="referrer" content="no-referrer">',
      SANDBOX_BASE_STYLES,
      SANDBOX_BOOTSTRAP,
      headContent,
      '</head>',
      `<body>${parsed.body.innerHTML}</body>`,
      '</html>'
    ].join('\n')
  }
}

export function SandboxedHtmlPreview({ content }: { readonly content: string }) {
  const preparedDocument = useMemo(() => buildSandboxedHtmlDocument(content), [content])
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  const stop = useCallback(() => {
    setFrameUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      return null
    })
  }, [])

  useEffect(() => {
    return () => {
      if (frameUrl) URL.revokeObjectURL(frameUrl)
    }
  }, [frameUrl])
  useEffect(() => {
    stop()
    setRuntimeError(null)
  }, [content, stop])

  const run = useCallback(() => {
    stop()
    setRuntimeError(null)
    if (!preparedDocument.ok) {
      setRuntimeError(preparedDocument.message)
      return
    }
    if (typeof URL.createObjectURL !== 'function') {
      setRuntimeError('当前运行环境不支持隔离 HTML 预览。')
      return
    }
    const blob = new Blob([preparedDocument.documentHtml], { type: 'text/html;charset=utf-8' })
    setFrameUrl(URL.createObjectURL(blob))
  }, [preparedDocument, stop])

  return (
    <section className="sandboxed-html-preview" aria-label="交互式 HTML 隔离预览">
      <div className="sandboxed-html-preview-header">
        <div>
          <strong>交互式内容 · 隔离沙箱</strong>
          <p>仅在你点击运行后执行；无网络、无 Electron/Node 权限，不与主页面同源。</p>
        </div>
        <div className="sandboxed-html-preview-actions">
          {frameUrl ? (
            <Button type="button" variant="secondary" onClick={stop}>停止</Button>
          ) : (
            <Button type="button" variant="secondary" onClick={run} disabled={!preparedDocument.ok}>
              运行交互预览
            </Button>
          )}
        </div>
      </div>

      {!preparedDocument.ok && <p className="sandboxed-html-preview-error">{preparedDocument.message}</p>}
      {runtimeError && <p className="sandboxed-html-preview-error">{runtimeError}</p>}
      {frameUrl && (
        <iframe
          className="sandboxed-html-preview-frame"
          title="隔离的交互式 HTML 预览"
          src={frameUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        />
      )}
    </section>
  )
}
