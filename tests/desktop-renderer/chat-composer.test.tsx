// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatComposer } from '../../apps/desktop/src/renderer/src/features/chat/ChatComposer.js'

describe('ChatComposer - Editing, IME & Draft preservation', () => {
  it('allows editing draft while streaming, shows Stop button, and retains draft', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn().mockResolvedValue(undefined)

    const view = render(
      <ChatComposer status="streaming" onSend={onSend} onCancel={onCancel} />
    )

    const textarea = screen.getByPlaceholderText(/Type your message/i) as HTMLTextAreaElement
    expect(textarea.disabled).toBe(false)

    // User types draft while AI is streaming
    await user.type(textarea, 'Drafting my next question')
    expect(textarea.value).toBe('Drafting my next question')

    // Stop button is visible
    const stopBtn = screen.getByRole('button', { name: 'Stop' })
    expect(stopBtn).toBeDefined()
    await user.click(stopBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)

    // Draft is not lost after cancel
    expect(textarea.value).toBe('Drafting my next question')

    // AI finished streaming (status idle) -> Send button appears, draft is still there!
    view.rerender(<ChatComposer status="idle" onSend={onSend} onCancel={onCancel} />)
    expect(textarea.value).toBe('Drafting my next question')

    const sendBtn = screen.getByRole('button', { name: 'Send' })
    expect(sendBtn).toBeDefined()
    await user.click(sendBtn)

    expect(onSend).toHaveBeenCalledWith('Drafting my next question')
    expect(textarea.value).toBe('')
  })

  it('shows non-blocking notice when hitting Enter during streaming, without sending or losing draft', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer status="streaming" onSend={onSend} onCancel={onCancel} />)

    const textarea = screen.getByPlaceholderText(/Type your message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Next query' } })

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })

    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe('Next query')
    expect(screen.getByRole('status').textContent).toContain('AI 正在回复中，草稿已保留')
  })

  it('does not send message on Enter during IME composition (Chinese / Japanese / Korean input)', () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer status="idle" onSend={onSend} onCancel={onCancel} />)

    const textarea = screen.getByPlaceholderText(/Type your message/i) as HTMLTextAreaElement

    // 1. Composition starts (user inputs pinyin: "nihao")
    fireEvent.compositionStart(textarea)
    fireEvent.change(textarea, { target: { value: '你好' } })

    // 2. User presses Enter to confirm candidate (keyCode 229 / isComposing true)
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      which: 229,
      shiftKey: false
    })

    // Should NOT submit during composition
    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe('你好')

    // 3. Composition ends
    fireEvent.compositionEnd(textarea)

    // 4. Now user presses Enter to send message
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      shiftKey: false
    })

    expect(onSend).toHaveBeenCalledWith('你好')
    expect(textarea.value).toBe('')
  })

  it('allows multiline draft with Shift+Enter without sending', () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer status="idle" onSend={onSend} onCancel={onCancel} />)

    const textarea = screen.getByPlaceholderText(/Type your message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Line 1' } })

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe('Line 1')
  })
})
