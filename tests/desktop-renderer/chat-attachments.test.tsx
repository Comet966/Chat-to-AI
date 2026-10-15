import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatComposer } from '../../apps/desktop/src/renderer/src/features/chat/ChatComposer.js'
import { readChatFiles, chatFileMediaType } from '../../apps/desktop/src/renderer/src/features/chat/read-chat-files.js'
import { ElectronChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/electron-chat-ui.adapter.js'
import type { DesktopApi } from '../../apps/desktop/src/shared/desktop-api.contract.js'
import { NamedChatAttachmentsSchema } from 'chat-contracts'
import { App } from '../../apps/desktop/src/renderer/src/app.js'
import { DemoChatUiAdapter } from '../../apps/desktop/src/renderer/src/adapters/demo-chat-ui.adapter.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'

const png = () => new File(['png-bytes'], 'diagram.png', { type: 'image/png' })
describe('GUI chat attachments', () => {
  it('selects and previews an image, removes it, and sends file-only input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<ChatComposer status="idle" onSend={onSend} onCancel={async () => {}} />)
    const input = screen.getByLabelText('选择聊天附件') as HTMLInputElement
    await user.upload(input, png())
    await screen.findByAltText('附件预览：diagram.png')
    expect(screen.getByText(/附件保存在本地/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: '移除附件 diagram.png' }))
    expect(screen.queryByAltText('附件预览：diagram.png')).toBeNull()
    await user.upload(input, png())
    await screen.findByAltText('附件预览：diagram.png')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('', [{ name: 'diagram.png', attachment: {
      type: 'image', mediaType: 'image/png', source: { type: 'base64', data: 'cG5nLWJ5dGVz' }
    } }])
    expect(screen.queryByAltText('附件预览：diagram.png')).toBeNull()
  })

  it('preserves text and attachments when the request is rejected', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(false)
    render(<ChatComposer status="idle" onSend={onSend} onCancel={async () => {}} />)
    await user.type(screen.getByLabelText('Message input'), 'Describe it')
    await user.upload(screen.getByLabelText('选择聊天附件'), png())
    await screen.findByAltText('附件预览：diagram.png')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect((screen.getByLabelText('Message input') as HTMLTextAreaElement).value).toBe('Describe it'))
    expect(screen.getByAltText('附件预览：diagram.png')).toBeDefined()
  })

  it('supports drop and clipboard images, preserves drafts during streaming, and blocks sending while streaming', async () => {
    const onSend = vi.fn()
    const view = render(<ChatComposer status="streaming" onSend={onSend} onCancel={async () => {}} />)
    fireEvent.drop(view.container.querySelector('.chat-composer')!, { dataTransfer: { files: [png()] } })
    await screen.findByAltText('附件预览：diagram.png')
    fireEvent.paste(screen.getByLabelText('Message input'), { clipboardData: { files: [new File(['pdf'], 'notes.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('notes.pdf')
    fireEvent.keyDown(screen.getByLabelText('Message input'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    view.rerender(<ChatComposer status="idle" onSend={onSend} onCancel={async () => {}} />)
    expect(screen.getByText('notes.pdf')).toBeDefined()
  })

  it('rejects empty, oversized, unsupported, excessive and unsafe-name files before reading', async () => {
    await expect(readChatFiles([new File([], 'empty.pdf')], [])).rejects.toThrow('空文件')
    await expect(readChatFiles([new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })], [])).rejects.toThrow('仅支持')
    await expect(readChatFiles([{ name: 'large.png', type: 'image/png', size: 20 * 1024 * 1024 + 1 } as File], [])).rejects.toThrow('20 MiB')
    await expect(readChatFiles(Array.from({ length: 11 }, png), [])).rejects.toThrow('10 个')
    await expect(readChatFiles([{ name: '../secret.png', type: 'image/png', size: 1 } as File], [])).rejects.toThrow('名称无效')
    await expect(readChatFiles(Array.from({ length: 3 }, (_, i) => ({ name: `${i}.png`, type: 'image/png', size: 18 * 1024 * 1024 } as File)), [])).rejects.toThrow('50 MiB')
  })

  it('maps PDF/audio and empty MIME extensions and retains existing attachments', async () => {
    const first = await readChatFiles([new File(['pdf'], 'notes.pdf')], [])
    const all = await readChatFiles([new File(['audio'], 'sound.wav', { type: 'audio/x-wav' })], first)
    expect(all.map((item) => item.attachment.type)).toEqual(['document', 'audio'])
    expect(all[0].attachment).toMatchObject({ filename: 'notes.pdf', mediaType: 'application/pdf' })
    expect(chatFileMediaType(new File(['audio'], 'sound.mp3'))).toBe('audio/mpeg')
    expect(NamedChatAttachmentsSchema.safeParse(all).success).toBe(true)
  })

  it('forwards transient bytes to the bridge but never retains bytes in chat UI state; handles bridge rejection', async () => {
    const api = { startTurn: vi.fn().mockResolvedValue({ ok: true, value: { requestId: 'r' } }) } as unknown as DesktopApi['conversation']
    const adapter = new ElectronChatUiAdapter(api)
    const attachments = await readChatFiles([png()], [])
    expect((await adapter.sendMessage({ content: '', attachments, expectedRevision: 0, currentNodeId: null, contextSelection: { mode: 'root-path', nodeIds: [] } })).ok).toBe(true)
    expect(api.startTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: '', attachments }))
    expect(adapter.getState().messages[0].content).toContain('diagram.png')
    expect(JSON.stringify(adapter.getState())).not.toContain('cG5nLWJ5dGVz')
    const rejected = new ElectronChatUiAdapter({ startTurn: vi.fn().mockRejectedValue(new Error('IPC failed')) } as unknown as DesktopApi['conversation'])
    expect((await rejected.sendMessage({ content: 'Describe', attachments, expectedRevision: 0, currentNodeId: null, contextSelection: { mode: 'root-path', nodeIds: [] } })).ok).toBe(false)
    expect(rejected.getState().status).toBe('failed')
    expect(rejected.getState().messages).toHaveLength(0)
  })

  it('blocks Anthropic audio before dispatch and preserves the draft for correction', async () => {
    window.location.hash = '#/'
    const user = userEvent.setup()
    const chatUi = new DemoChatUiAdapter()
    const send = vi.spyOn(chatUi, 'sendMessage')
    render(<App customPorts={{ chatUi, providerSettings: new InMemoryProviderSettingsAdapter({ provider: 'anthropic', modelId: 'claude-test' }) }} />)
    await screen.findByText('claude-test')
    await user.type(screen.getByLabelText('Message input'), 'Transcribe')
    await user.upload(screen.getByLabelText('选择聊天附件'), new File(['audio'], 'sound.mp3', { type: 'audio/mpeg' }))
    await screen.findByText('sound.mp3')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText(/Anthropic Messages 不支持音频输入/)
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByText('sound.mp3')).toBeDefined()
    expect((screen.getByLabelText('Message input') as HTMLTextAreaElement).value).toBe('Transcribe')
  })
})
