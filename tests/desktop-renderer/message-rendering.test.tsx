// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MessageContent,
  MAX_SVG_ATTRIBUTE_LENGTH,
  MAX_SVG_NODE_COUNT,
  MAX_SVG_VIEWBOX_DIMENSION,
  sanitizeAssistantHtml
} from '../../apps/desktop/src/renderer/src/features/chat/MessageContent.js'
import {
  buildSandboxedHtmlDocument,
  MAX_INTERACTIVE_HTML_LENGTH,
  MAX_INTERACTIVE_SCRIPT_COUNT
} from '../../apps/desktop/src/renderer/src/features/chat/SandboxedHtmlPreview.js'
import { MessageItem } from '../../apps/desktop/src/renderer/src/features/chat/MessageItem.js'
import { RenderModeToggle } from '../../apps/desktop/src/renderer/src/features/chat/RenderModeToggle.js'

describe('MessageContent - Markdown mode', () => {
  it('renders standard Markdown elements (headings, bold, lists, quotes, code, tables)', () => {
    const markdownContent = [
      '# Heading 1',
      '## Heading 2',
      '**Bold text** and *italic text* and ~~strikethrough~~',
      '',
      '> A notable quote',
      '',
      '- Item A',
      '- Item B',
      '',
      '1. First',
      '2. Second',
      '',
      'Inline `console.log(42)` code',
      '',
      '```typescript',
      'const value: number = 42;',
      '```',
      '',
      '| Header 1 | Header 2 |',
      '| --- | --- |',
      '| Cell 1 | Cell 2 |',
      '',
      '[Example Link](https://example.com)'
    ].join('\n')

    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="markdown"
        content={markdownContent}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Heading 1' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Heading 2' })).toBeDefined()
    expect(container.querySelector('strong')?.textContent).toBe('Bold text')
    expect(container.querySelector('em')?.textContent).toBe('italic text')
    expect(container.querySelector('del')?.textContent).toBe('strikethrough')
    expect(container.querySelector('blockquote')?.textContent).toContain('A notable quote')
    expect(container.querySelectorAll('li').length).toBe(4)
    expect(container.querySelector('code')?.textContent).toContain('console.log(42)')
    expect(container.querySelector('pre code')?.textContent).toContain('const value: number = 42;')
    expect(container.querySelector('table')).toBeDefined()
    expect(container.querySelector('th')?.textContent).toBe('Header 1')
    expect(container.querySelector('td')?.textContent).toBe('Cell 1')
    expect(screen.getByRole('link', { name: 'Example Link' })).toBeDefined()
  })

  it('renders LaTeX inline math and display math using KaTeX', () => {
    const mathContent = [
      'Einstein formula is $E = mc^2$ in physics.',
      '',
      '$$\\int_0^\\infty e^{-x} dx = 1$$'
    ].join('\n\n')

    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="markdown"
        content={mathContent}
      />
    )

    // KaTeX renders .katex and .katex-display
    const katexElements = container.querySelectorAll('.katex')
    expect(katexElements.length).toBeGreaterThanOrEqual(1)
    const displayMath = container.querySelector('.katex-display')
    expect(displayMath).toBeDefined()
  })

  it('gracefully handles invalid or incomplete LaTeX math without throwing', () => {
    const brokenMath = 'Broken formula: $$\\frac{1}{$$ and single $incomplete'
    expect(() => {
      render(
        <MessageContent
          role="assistant"
          renderMode="markdown"
          content={brokenMath}
        />
      )
    }).not.toThrow()
  })

  it('does not execute or inject raw HTML embedded in Markdown (skipHtml)', () => {
    const content = 'Text with <button id="raw-btn">Click</button> and <script>attack()</script>'
    const { container } = render(
      <MessageContent role="assistant" renderMode="markdown" content={content} />
    )

    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('Text with')
  })

  it('prevents link click navigation in Markdown mode', async () => {
    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="markdown"
        content="[Link](https://example.com/target)"
      />
    )

    const anchor = container.querySelector('a')
    expect(anchor).toBeDefined()
    if (!anchor) return

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(clickEvent)
    expect(clickEvent.defaultPrevented).toBe(true)
  })
})

describe('MessageContent - HTML mode and Sanitization', () => {
  it('renders safe HTML elements correctly', () => {
    const html = [
      '<h2>Safe Subtitle</h2>',
      '<p>Paragraph with <strong>strong</strong>, <em>emphasis</em>, and <code>code</code>.</p>',
      '<blockquote>A quote</blockquote>',
      '<ul><li>Item 1</li><li>Item 2</li></ul>',
      '<table><thead><tr><th>Col A</th></tr></thead><tbody><tr><td>Val A</td></tr></tbody></table>'
    ].join('')

    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={html} />
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Safe Subtitle' })).toBeDefined()
    expect(container.querySelector('strong')?.textContent).toBe('strong')
    expect(container.querySelector('em')?.textContent).toBe('emphasis')
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(container.querySelector('blockquote')?.textContent).toBe('A quote')
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelector('table')).toBeDefined()
    expect(container.querySelector('th')?.textContent).toBe('Col A')
    expect(container.querySelector('td')?.textContent).toBe('Val A')
  })

  it('renders supported declarative HTML components without JavaScript', () => {
    const html = [
      '<details open><summary>More information</summary><p>Static disclosure content.</p></details>',
      '<figure><pre><code>const answer = 42;</code></pre><figcaption>Example source</figcaption></figure>',
      '<progress value="70" max="100">70%</progress>',
      '<meter min="0" max="10" value="8" optimum="9">8/10</meter>'
    ].join('')

    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={html} />
    )

    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
    expect(container.querySelector('summary')?.textContent).toBe('More information')
    expect(container.querySelector('figcaption')?.textContent).toBe('Example source')
    expect(container.querySelector('progress')?.getAttribute('value')).toBe('70')
    expect(container.querySelector('meter')?.getAttribute('optimum')).toBe('9')
  })

  it('renders safe inline SVG graphics in HTML mode', () => {
    const svgContent = [
      '<p>Here is an architecture diagram:</p>',
      '<svg viewBox="0 0 100 100" width="100" height="100">',
      '  <circle cx="50" cy="50" r="40" fill="green" stroke="black" stroke-width="2" />',
      '  <rect x="10" y="10" width="30" height="30" fill="blue" />',
      '  <line x1="0" y1="0" x2="100" y2="100" stroke="red" />',
      '  <text x="20" y="50">Node</text>',
      '</svg>'
    ].join('\n')

    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={svgContent} />
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeDefined()
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe('green')
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('blue')
    expect(container.querySelector('text')?.textContent).toBe('Node')
  })

  it('renders multiple accessible SVG diagrams with gradients, clipping paths, masks, and markers', () => {
    const svgContent = [
      '<svg viewBox="0 0 120 60" role="img" aria-label="Flow diagram">',
      '  <title>Flow</title><desc>Two connected nodes</desc>',
      '  <defs>',
      '    <linearGradient id="gradient"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/></linearGradient>',
      '    <clipPath id="clip"><rect x="0" y="0" width="120" height="60" rx="6"/></clipPath>',
      '    <mask id="fade"><rect x="0" y="0" width="120" height="60" fill="white"/></mask>',
      '    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="currentColor"/></marker>',
      '  </defs>',
      '  <g clip-path="url(#clip)" mask="url(#fade)"><rect width="120" height="60" fill="url(#gradient)"/></g>',
      '  <line x1="20" y1="30" x2="100" y2="30" stroke="currentColor" marker-end="url(#arrow)"/>',
      '</svg>',
      '<svg viewBox="0 0 20 20"><title>Status</title><circle cx="10" cy="10" r="8" fill="green"/></svg>'
    ].join('')

    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={svgContent} />
    )

    expect(container.querySelectorAll('svg')).toHaveLength(2)
    expect(container.querySelector('linearGradient')).toBeDefined()
    expect(container.querySelector('clipPath')).toBeDefined()
    expect(container.querySelector('mask')).toBeDefined()
    expect(container.querySelector('marker')).toBeDefined()
    expect(container.querySelector('title')?.textContent).toBe('Flow')
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 120 60')
    expect(container.querySelector('linearGradient')?.getAttribute('id')).toBe('gradient')
    expect(container.querySelector('g')?.getAttribute('clip-path')).toBe('url(#clip)')
    expect(container.querySelector('g')?.getAttribute('mask')).toBe('url(#fade)')
    expect(container.querySelector('line')?.getAttribute('marker-end')).toBe('url(#arrow)')
    expect(container.querySelector('.message-content-svg-fallback')).toBeNull()
  })

  it('strictly sanitizes dangerous, active, and resource-injecting SVG tags', () => {
    const dangerousSvg = [
      '<svg viewBox="0 0 100 100">',
      '  <script>alert("svg xss")</script>',
      '  <foreignObject width="100" height="100"><iframe src="https://evil.com"></iframe></foreignObject>',
      '  <use href="#malicious" xlink:href="#malicious"/>',
      '  <image href="https://tracker.com/img.png"/>',
      '  <animate attributeName="x" from="0" to="100"/>',
      '  <animateTransform attributeName="transform" type="rotate" from="0" to="360"/>',
      '  <a href="javascript:alert(1)"><circle cx="10" cy="10" r="5"/></a>',
      '  <circle cx="50" cy="50" r="20" onload="alert(2)" style="fill:red;"/>',
      '</svg>'
    ].join('\n')

    const sanitized = sanitizeAssistantHtml(dangerousSvg)
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('<foreignObject')
    expect(sanitized).not.toContain('<iframe')
    expect(sanitized).not.toContain('<use')
    expect(sanitized).not.toContain('<image')
    expect(sanitized).not.toContain('<animate')
    expect(sanitized).not.toContain('href=')
    expect(sanitized).not.toContain('xlink:href=')
    expect(sanitized).not.toContain('onload=')
    expect(sanitized).not.toContain('style=')
    expect(sanitized).not.toContain('javascript:')
  })

  it('falls back to text when an SVG exceeds safe complexity limits', () => {
    const oversizedAttribute = 'm'.repeat(MAX_SVG_ATTRIBUTE_LENGTH + 1)
    const tooManyNodes = Array.from(
      { length: MAX_SVG_NODE_COUNT },
      (_, index) => `<circle cx="${index}" cy="1" r="1" />`
    ).join('')
    const oversizedViewBox = MAX_SVG_VIEWBOX_DIMENSION + 1

    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content={`<svg viewBox="0 0 ${oversizedViewBox} 10"><path d="${oversizedAttribute}"/>${tooManyNodes}</svg>`}
      />
    )

    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('SVG 内容不符合安全或资源限制')
    expect(container.querySelector('.message-content-svg-fallback')).toBeDefined()
  })

  it('strips active, destructive, and resource-injecting HTML tags', () => {
    const malicious = [
      '<script>alert("xss")</script>',
      '<style>body { display: none; }</style>',
      '<iframe src="https://evil.com"></iframe>',
      '<frame src="https://evil.com">',
      '<frameset><frame></frameset>',
      '<object data="evil.swf"></object>',
      '<embed src="evil.swf">',
      '<applet code="Evil"></applet>',
      '<form action="/steal"><input name="token" value="abc"/><button type="submit">Submit</button><select><option>1</option></select><textarea>notes</textarea></form>',
      '<base href="https://attacker.com/">',
      '<meta http-equiv="refresh" content="0;url=https://attacker.com/">',
      '<link rel="stylesheet" href="https://attacker.com/evil.css">',
      '<img src="https://attacker.com/tracker.png" alt="tracker"/>',
      '<audio src="https://attacker.com/audio.mp3"></audio>',
      '<video src="https://attacker.com/video.mp4"></video>',
      '<dialog open>dialog</dialog>'
    ].join('\n')

    const sanitized = sanitizeAssistantHtml(malicious)
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('<style')
    expect(sanitized).not.toContain('<iframe')
    expect(sanitized).not.toContain('<frame')
    expect(sanitized).not.toContain('<object')
    expect(sanitized).not.toContain('<embed')
    expect(sanitized).not.toContain('<applet')
    expect(sanitized).not.toContain('<form')
    expect(sanitized).not.toContain('<input')
    expect(sanitized).not.toContain('<button')
    expect(sanitized).not.toContain('<select')
    expect(sanitized).not.toContain('<textarea')
    expect(sanitized).not.toContain('<base')
    expect(sanitized).not.toContain('<meta')
    expect(sanitized).not.toContain('<link')
    expect(sanitized).not.toContain('<img')
    expect(sanitized).not.toContain('<audio')
    expect(sanitized).not.toContain('<video')
    expect(sanitized).not.toContain('<dialog')
  })

  it('removes inline event handlers, style attributes, and dangerous URL schemes', () => {
    const dangerous = [
      '<div onclick="alert(1)" onmouseover="alert(2)" style="color: red; position: fixed;">Text</div>',
      '<a href="javascript:alert(1)">JS Link</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Data Link</a>',
      '<a href="vbscript:msgbox(1)">VBS Link</a>'
    ].join('\n')

    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={dangerous} />
    )

    const sanitized = sanitizeAssistantHtml(dangerous)
    expect(sanitized).not.toContain('onclick=')
    expect(sanitized).not.toContain('onmouseover=')
    expect(sanitized).not.toContain('style=')
    expect(sanitized).not.toContain('href=')
    expect(container.querySelector('.message-content-html')).toBeNull()
    expect(container.querySelector('.sandboxed-html-preview')).not.toBeNull()
  })

  it('never executes embedded JavaScript or displays a broken static copy of an interactive document', () => {
    const run = vi.fn()
    Object.assign(window, { __unsafeHtmlTest: run })

    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content={'<p onclick="window.__unsafeHtmlTest()">Safe text</p><script>window.__unsafeHtmlTest()</script><interactive-chart data-source="remote">Static fallback</interactive-chart><pre><code>console.log(&quot;shown only&quot;)</code></pre>'}
      />
    )

    expect(run).not.toHaveBeenCalled()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('p[onclick]')).toBeNull()
    expect(container.querySelector('interactive-chart')).toBeNull()
    expect(container.querySelector('.message-content-html')).toBeNull()
    expect(container.querySelector('.message-content-html-source code')?.textContent).toContain('Static fallback')
    expect(container.querySelector('.message-content-html-source code')?.textContent).toContain('shown only')
    expect(screen.getByRole('status').textContent).toContain('交互内容仅在隔离沙箱中显示')
    expect(screen.getByRole('button', { name: '运行交互预览' })).toBeDefined()

    Reflect.deleteProperty(window, '__unsafeHtmlTest')
  })

  it('renders explanation outside a fenced interactive HTML demo as Markdown', () => {
    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content={[
          '## 计数器说明',
          '',
          '下面是**交互演示**：',
          '',
          '```html',
          '<button id="counter">Count</button><script>document.querySelector("#counter").textContent = "Ready"</script>',
          '```',
          '',
          '点击运行后查看效果。'
        ].join('\n')}
      />
    )

    expect(screen.getByRole('heading', { name: '计数器说明' })).toBeDefined()
    expect(container.querySelector('strong')?.textContent).toBe('交互演示')
    expect(container.querySelector('.message-content-html')).toBeNull()
    expect(container.querySelector('.message-content-html-source code')?.textContent).toContain('<button id="counter">')
    expect(container.querySelector('.message-content-html-source code')?.textContent).not.toContain('```html')
    expect(screen.getByText('点击运行后查看效果。')).toBeDefined()
    expect(screen.getByRole('button', { name: '运行交互预览' })).toBeDefined()
  })

  it('renders a fenced static HTML answer without leaking Markdown fence markers', () => {
    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={'```html\n<h2>标题</h2><p>内容</p>\n```'} />
    )

    expect(screen.getByRole('heading', { name: '标题' })).toBeDefined()
    expect(container.textContent).not.toContain('```')
    expect(container.querySelector('.sandboxed-html-preview')).toBeNull()
  })

  it('keeps plain Markdown readable when an HTML-declared model answer contains no HTML', () => {
    const { container } = render(
      <MessageContent role="assistant" renderMode="html" content={'## 说明\n\n- 第一步\n- 第二步'} />
    )

    expect(screen.getByRole('heading', { name: '说明' })).toBeDefined()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('keeps a leading explanation outside an unfenced interactive HTML fragment', () => {
    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content={'这是一个**交互示例**：\n\n<button>Run</button><script>void 0</script>'}
      />
    )

    expect(container.querySelector('strong')?.textContent).toBe('交互示例')
    expect(container.querySelector('.message-content-html')).toBeNull()
    expect(container.querySelector('.message-content-html-source code')?.textContent).toBe('<button>Run</button><script>void 0</script>')
  })

  it('keeps an unfinished HTML fence as escaped source while streaming', () => {
    const { container, rerender } = render(
      <MessageContent role="assistant" renderMode="html" content={'```html\n<button>Run'} />
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('<button>Run')

    rerender(
      <MessageContent role="assistant" renderMode="html" content={'```html\n<button>Run</button>\n```'} />
    )
    expect(container.querySelector('.message-content-html')).toBeNull()
    expect(screen.getByRole('button', { name: '运行交互预览' })).toBeDefined()
  })

  it('builds a bounded no-network document for the interactive sandbox', () => {
    const result = buildSandboxedHtmlDocument([
      '<button id="counter">Count</button>',
      '<iframe src="https://example.com"></iframe>',
      '<script src="https://example.com/app.js">document.querySelector("#counter").textContent = "Ready"</script>'
    ].join(''))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.documentHtml).toContain("connect-src 'none'")
    expect(result.documentHtml).toContain("worker-src 'none'")
    expect(result.documentHtml).toContain('HTML preview sandbox')
    expect(result.documentHtml).toContain('id="counter"')
    expect(result.documentHtml).toContain('textContent = "Ready"')
    expect(result.documentHtml).not.toContain('<iframe')
    expect(result.documentHtml).not.toContain('https://example.com')
  })

  it('requires an explicit click before creating an opaque-origin script sandbox', async () => {
    const createObjectUrl = vi.fn(() => 'blob:https://app.invalid/interactive-preview')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl
    })

    const user = userEvent.setup()
    const { container, unmount } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content='<button id="run">Run</button><script>document.querySelector("#run").textContent = "Ran"</script>'
      />
    )

    expect(createObjectUrl).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')).toBeNull()

    await user.click(screen.getByRole('button', { name: '运行交互预览' }))
    const iframe = container.querySelector('iframe')
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('src')).toBe('blob:https://app.invalid/interactive-preview')
    expect(iframe?.getAttribute('allow')).not.toContain('same-origin')

    await user.click(screen.getByRole('button', { name: '停止' }))
    expect(container.querySelector('iframe')).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:https://app.invalid/interactive-preview')
    unmount()
  })

  it('rejects oversized interactive documents and excessive script counts', () => {
    expect(buildSandboxedHtmlDocument('x'.repeat(MAX_INTERACTIVE_HTML_LENGTH + 1)).ok).toBe(false)
    const tooManyScripts = Array.from(
      { length: MAX_INTERACTIVE_SCRIPT_COUNT + 1 },
      (_, index) => `<script>window.value${index} = ${index}</script>`
    ).join('')
    expect(buildSandboxedHtmlDocument(tooManyScripts).ok).toBe(false)
  })

  it('rejects SVG presentation attributes that reference external resources', () => {
    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content='<svg viewBox="0 0 20 20"><rect width="20" height="20" fill="url(https://example.com/paint.svg#gradient)"/></svg>'
      />
    )

    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('SVG 内容不符合安全或资源限制')
  })

  it('prevents link click navigation in HTML mode', () => {
    const { container } = render(
      <MessageContent
        role="assistant"
        renderMode="html"
        content='<a href="https://example.com/target">Target Link</a>'
      />
    )

    const anchor = container.querySelector('a')
    expect(anchor).toBeDefined()
    if (!anchor) return

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(clickEvent)
    expect(clickEvent.defaultPrevented).toBe(true)
  })
})

describe('MessageContent - User message plain text rule', () => {
  it('always displays user content as plain text regardless of renderMode or tags', () => {
    const rawInput = '<script>alert(1)</script><strong>Hello</strong>\n# Heading\n- item'

    const view1 = render(
      <MessageContent role="user" renderMode="markdown" content={rawInput} />
    )
    expect(view1.container.querySelector('strong')).toBeNull()
    expect(view1.container.querySelector('h1')).toBeNull()
    expect(view1.container.querySelector('li')).toBeNull()
    expect(view1.container.querySelector('.message-content-plain')?.textContent).toBe(rawInput)

    view1.rerender(
      <MessageContent role="user" renderMode="html" content={rawInput} />
    )
    expect(view1.container.querySelector('strong')).toBeNull()
    expect(view1.container.querySelector('script')).toBeNull()
    expect(view1.container.querySelector('.message-content-plain')?.textContent).toBe(rawInput)
  })
})

describe('MessageContent - declared output format', () => {
  it('uses the Main-projected format declaration instead of silently changing an old response', () => {
    const { container } = render(
      <MessageItem
        renderMode="html"
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: '# Markdown heading',
          timestamp: '2026-10-04T00:00:00.000Z',
          declaredOutputFormat: 'markdown',
          templateVersion: 1
        }}
      />
    )

    expect(container.querySelector('h1')?.textContent).toBe('Markdown heading')
    expect(container.querySelector('.message-content-html')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('声明的 markdown 格式安全渲染')
  })
})

describe('MessageContent - Streaming and edge cases', () => {
  it('handles empty content gracefully', () => {
    const view = render(
      <MessageContent role="assistant" renderMode="markdown" content="" />
    )
    expect(view.container.querySelector('.message-content')).toBeDefined()

    view.rerender(<MessageContent role="assistant" renderMode="html" content="" />)
    expect(view.container.querySelector('.message-content')).toBeDefined()
  })

  it('tolerates incomplete Markdown and HTML during streaming', () => {
    const incompleteMarkdownSteps = [
      '*',
      '**',
      '**bold',
      '**bold** and `',
      '**bold** and `code',
      '**bold** and `code`\n\n```py',
      '**bold** and `code`\n\n```python\nprint(1',
      '**bold** and `code`\n\n```python\nprint(1)\n```'
    ]

    const { container, rerender } = render(
      <MessageContent role="assistant" renderMode="markdown" content="" />
    )

    for (const step of incompleteMarkdownSteps) {
      expect(() => {
        rerender(<MessageContent role="assistant" renderMode="markdown" content={step} />)
      }).not.toThrow()
    }
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('pre code')?.textContent).toContain('print(1)')

    const incompleteHtmlSteps = [
      '<',
      '<div',
      '<div>',
      '<div><p',
      '<div><p>',
      '<div><p>Streaming text',
      '<div><p>Streaming text</p></div>'
    ]

    for (const step of incompleteHtmlSteps) {
      expect(() => {
        rerender(<MessageContent role="assistant" renderMode="html" content={step} />)
      }).not.toThrow()
    }
    expect(container.textContent).toContain('Streaming text')
  })

  it('preserves Unicode and emojis', () => {
    const unicode = 'Hello 世界 🌍 🚀 «quotes» & [brackets]'
    const { container, rerender } = render(
      <MessageContent role="assistant" renderMode="markdown" content={unicode} />
    )
    expect(container.textContent).toContain('Hello 世界 🌍 🚀 «quotes» & [brackets]')

    rerender(<MessageContent role="assistant" renderMode="html" content={`<p>${unicode}</p>`} />)
    expect(container.textContent).toContain('Hello 世界 🌍 🚀 «quotes» & [brackets]')
  })
})

describe('RenderModeToggle', () => {
  it('renders mode options with accessible group label and correct aria-pressed', () => {
    const onChange = vi.fn()
    render(<RenderModeToggle mode="markdown" onChange={onChange} />)

    const group = screen.getByRole('group', { name: '回复渲染模式' })
    expect(group).toBeDefined()

    const mdBtn = screen.getByRole('button', { name: 'Markdown' })
    const htmlBtn = screen.getByRole('button', { name: 'HTML' })

    expect(mdBtn.getAttribute('aria-pressed')).toBe('true')
    expect(htmlBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('triggers onChange on button click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<RenderModeToggle mode="markdown" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'HTML' }))
    expect(onChange).toHaveBeenCalledWith('html')

    rerender(<RenderModeToggle mode="html" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'HTML' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Markdown' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('supports keyboard navigation via Enter and Space', () => {
    const onChange = vi.fn()
    render(<RenderModeToggle mode="markdown" onChange={onChange} />)

    const htmlBtn = screen.getByRole('button', { name: 'HTML' })
    fireEvent.keyDown(htmlBtn, { key: 'Enter', code: 'Enter' })
    fireEvent.click(htmlBtn)
    expect(onChange).toHaveBeenCalledWith('html')
  })
})
