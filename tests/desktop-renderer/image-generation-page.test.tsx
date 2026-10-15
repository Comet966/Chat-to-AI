import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../apps/desktop/src/renderer/src/app.js'
import { InMemoryProviderSettingsAdapter } from '../../apps/desktop/src/renderer/src/adapters/in-memory-provider-settings.adapter.js'
import type { DesktopImageResult, DesktopImageGenerationDto } from '../../apps/desktop/src/shared/image-generation.contract.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const success: DesktopImageResult<DesktopImageGenerationDto> = { ok: true, value: {
  requestId: 'img', modelId: 'image-model', output: { images: [{ type: 'base64', mediaType: 'image/png', data: png }], text: '<script>doNotExecute()</script>' }
} }

function setup(overrides: Record<string, unknown> = {}) {
  window.location.hash = '#/images'
  const imageGeneration = {
    generate: vi.fn().mockResolvedValue(success), cancel: vi.fn().mockResolvedValue({ ok: true, value: { cancelled: true } }),
    save: vi.fn().mockResolvedValue({ ok: true, value: { saved: true } })
  }
  const providerSettings = new InMemoryProviderSettingsAdapter({
    provider: 'openai-compatible', apiKey: 'key', hasApiKey: true, modelId: 'chat-model', ...overrides
  })
  const view = render(<App customPorts={{ imageGeneration, providerSettings }} />)
  return { ...view, imageGeneration, providerSettings }
}

async function fillPrompt() {
  const user = userEvent.setup()
  await screen.findByDisplayValue('chat-model')
  await user.clear(screen.getByLabelText('生图模型'))
  await user.type(screen.getByLabelText('生图模型'), 'image-model')
  await user.selectOptions(screen.getByLabelText('生图端点'), 'chat-completions')
  await user.type(screen.getByLabelText('提示词'), 'Blue square')
  return user
}

afterEach(() => { window.location.hash = '' })

describe('ImageGenerationPage', () => {
  it('navigates through an icon-only rail and generates images without altering chat settings', async () => {
    const { imageGeneration, providerSettings, container } = setup()
    const user = await fillPrompt()
    expect(screen.getByRole('link', { name: '生图' }).textContent).toBe('')
    await user.click(screen.getByRole('button', { name: '生成图片' }))
    const image = await screen.findByAltText('生成图片 1')
    expect(image.getAttribute('src')).toBe(`data:image/png;base64,${png}`)
    expect(imageGeneration.generate).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'image-model', endpoint: 'chat-completions', prompt: 'Blue square' }))
    expect(JSON.stringify(imageGeneration.generate.mock.calls)).not.toContain('apiKey')
    expect(await providerSettings.getSettings()).toMatchObject({ ok: true, value: { modelId: 'chat-model' } })
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>doNotExecute()</script>')).toBeDefined()
    await user.click(screen.getByRole('button', { name: '保存图片 1' }))
    expect(imageGeneration.save).toHaveBeenCalledWith({ requestId: 'img', imageIndex: 0 })
    expect(await screen.findByText('图片已保存')).toBeDefined()
    await user.click(screen.getByRole('link', { name: '对话' }))
    expect(await screen.findByText('AI Conversation')).toBeDefined()
  })

  it('locks the form while generating, cancels by request ID, and permits retry', async () => {
    const { imageGeneration } = setup()
    let complete!: (value: unknown) => void
    imageGeneration.generate.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const user = await fillPrompt()
    await user.click(screen.getByRole('button', { name: '生成图片' }))
    expect((screen.getByLabelText('生图模型') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('提示词') as HTMLTextAreaElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: '取消生成' }))
    const requestId = imageGeneration.generate.mock.calls[0][0].requestId
    expect(imageGeneration.cancel).toHaveBeenCalledWith({ requestId })
    await act(async () => { complete({ ok: false, error: { code: 'CANCELLED', message: '图片生成已取消或超时' } }) })
    expect(await screen.findByText('图片生成已取消或超时')).toBeDefined()
    expect((screen.getByRole('button', { name: '生成图片' }) as HTMLButtonElement).disabled).toBe(false)
    expect(imageGeneration.generate).toHaveBeenCalledTimes(1)
  })

  it('cancels outstanding work when leaving the module', async () => {
    const { imageGeneration } = setup()
    imageGeneration.generate.mockImplementationOnce(() => new Promise(() => {}))
    const user = await fillPrompt()
    await user.click(screen.getByRole('button', { name: '生成图片' }))
    await user.click(screen.getByRole('link', { name: '对话' }))
    await waitFor(() => expect(imageGeneration.cancel).toHaveBeenCalledWith({ requestId: imageGeneration.generate.mock.calls[0][0].requestId }))
  })

  it('shows provider failures and does not display a successful image', async () => {
    const { imageGeneration } = setup()
    imageGeneration.generate.mockResolvedValueOnce({ ok: false, error: { code: 'MODEL_REQUEST_FAILED', message: '模型不支持当前端点' } })
    const user = await fillPrompt()
    await user.click(screen.getByRole('button', { name: '生成图片' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '模型不支持当前端点')
    expect(screen.queryByAltText('生成图片 1')).toBeNull()
  })

  it('shows external URLs as inert text rather than issuing renderer network requests', async () => {
    const { imageGeneration } = setup()
    imageGeneration.generate.mockResolvedValueOnce({ ok: true, value: { requestId: 'img', modelId: 'image-model', output: {
      images: [{ type: 'url', url: 'https://example.com/result.png' }]
    } } })
    const user = await fillPrompt()
    await user.click(screen.getByRole('button', { name: '生成图片' }))
    expect(await screen.findByDisplayValue('https://example.com/result.png')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('does not enable generation without credentials or for Anthropic', async () => {
    const view = setup({ apiKey: '', hasApiKey: false })
    await screen.findByDisplayValue('chat-model')
    expect((screen.getByRole('button', { name: '生成图片' }) as HTMLButtonElement).disabled).toBe(true)
    view.unmount()
    setup({ provider: 'anthropic' })
    expect(await screen.findByText('Anthropic 没有文生图 API，请切换供应商。')).toBeDefined()
    expect(screen.queryByLabelText('生图端点')).toBeNull()
  })
})
