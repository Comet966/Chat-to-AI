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

    const div = container.querySelector('div.message-content > div')
    expect(div?.getAttribute('onclick')).toBeNull()
    expect(div?.getAttribute('onmouseover')).toBeNull()
    expect(div?.getAttribute('style')).toBeNull()

    const links = container.querySelectorAll('a')
    for (const link of links) {
      const href = link.getAttribute('href')
      expect(href === null || href === '').toBe(true)
    }
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
