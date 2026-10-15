import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button.js'
import { Field } from '../components/Field.js'
import { StatusNotice } from '../components/StatusNotice.js'
import { usePorts } from '../ports/ports.context.js'
import { UnavailableImageGenerationAdapter } from '../adapters/electron-image-generation.adapter.js'
import type { ProviderSettingsData } from '../ports/provider-settings.port.js'
import type { DesktopImageGenerationDto } from '../../../shared/image-generation.contract.js'

export function ImageGenerationPage() {
  const { providerSettings, imageGeneration } = usePorts()
  const port = useMemo(() => imageGeneration ?? new UnavailableImageGenerationAdapter(), [imageGeneration])
  const [settings, setSettings] = useState<ProviderSettingsData | null>(null)
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<readonly string[]>([])
  const [endpoint, setEndpoint] = useState<'images' | 'chat-completions'>('images')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [listing, setListing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<DesktopImageGenerationDto | null>(null)
  const mounted = useRef(false)
  const activeRequest = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    let stale = false
    void providerSettings.getSettings().then((response) => {
      if (stale) return
      if (response.ok) { setSettings(response.value); setModelId(response.value.modelId) }
      else setError(response.error.message)
    }).catch(() => { if (!stale) setError('读取供应商配置失败') })
    return () => {
      stale = true
      mounted.current = false
      const requestId = activeRequest.current
      activeRequest.current = null
      if (requestId) void port.cancel({ requestId }).catch(() => {})
    }
  }, [providerSettings, port])

  const configured = !!settings?.hasApiKey || !!settings?.apiKey
  const unsupported = settings?.provider === 'anthropic'

  async function listModels() {
    if (!settings || listing || generating) return
    setListing(true)
    setError('')
    try {
      const response = await providerSettings.listModels(settings)
      if (!mounted.current) return
      if (response.ok) setModels(response.value)
      else setError(response.error.message)
    } catch { if (mounted.current) setError('获取模型列表失败，仍可手动输入模型 ID') }
    finally { if (mounted.current) setListing(false) }
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault()
    if (activeRequest.current || !configured || unsupported || !modelId.trim() || !prompt.trim()) return
    const requestId = crypto.randomUUID()
    activeRequest.current = requestId
    setGenerating(true)
    setError('')
    setNotice('正在生成图片，最长等待 3 分钟；图片将在生成完成后显示。')
    try {
      const response = await port.generate({
        requestId, prompt: prompt.trim(), modelId: modelId.trim(),
        ...(settings?.provider === 'openai-compatible' ? { endpoint } : {})
      })
      if (!mounted.current || activeRequest.current !== requestId) return
      if (response.ok) { setResult(response.value); setNotice('图片生成完成') }
      else if (response.error.code === 'CANCELLED') { setNotice(response.error.message); setError('') }
      else { setError(response.error.message); setNotice('') }
    } catch { if (mounted.current && activeRequest.current === requestId) { setError('生图服务调用失败'); setNotice('') } }
    finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null
        if (mounted.current) setGenerating(false)
      }
    }
  }

  async function cancel() {
    const requestId = activeRequest.current
    if (!requestId) return
    try {
      const response = await port.cancel({ requestId })
      if (!mounted.current || activeRequest.current !== requestId) return
      if (!response.ok) setError(response.error.message)
      else if (response.value.cancelled) setNotice('正在取消，请稍候…')
    } catch { if (mounted.current) setError('取消请求失败，请稍后重试') }
  }

  async function save(imageIndex: number) {
    if (!result || saving || generating) return
    setSaving(true)
    setError('')
    try {
      const response = await port.save({ requestId: result.requestId, imageIndex })
      if (!mounted.current) return
      if (response.ok) setNotice(response.value.saved ? '图片已保存' : '已取消保存')
      else setError(response.error.message)
    } catch { if (mounted.current) setError('保存图片失败') }
    finally { if (mounted.current) setSaving(false) }
  }

  return (
    <div className="page-container image-generation-page">
      <header className="image-generation-header">
        <div><h1>图片生成</h1><p>复用供应商配置的地址和密钥；生图模型独立，不改变对话模型和会话树。</p></div>
        <Link className="btn btn-secondary" to="/settings/providers">供应商配置</Link>
      </header>
      {error && <div role="alert" className="status-notice status-notice-danger">{error}</div>}
      {notice && <StatusNotice message={notice} type="info" />}
      <div className="image-generation-workspace">
        <form onSubmit={generate} className="image-generation-form" aria-label="生图参数">
          <p className="field-hint">当前供应商：{settings?.provider ?? '正在读取…'}</p>
          {!configured && settings && <StatusNotice type="warning" message="请先保存供应商地址和 API Key。" />}
          {unsupported && <StatusNotice type="warning" message="Anthropic 没有文生图 API，请切换供应商。" />}
          <Field label="生图模型" htmlFor="image-model" hint="可手动输入模型 ID，不会修改聊天模型。">
            <input id="image-model" className="field-input" list="image-model-list" maxLength={256}
              value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={generating || saving} required />
            <datalist id="image-model-list">{models.map((model) => <option key={model} value={model} />)}</datalist>
          </Field>
          <Button variant="secondary" disabled={!configured || listing || generating || saving} onClick={listModels}>
            {listing ? '正在获取…' : '获取模型列表'}
          </Button>
          {settings?.provider === 'openai-compatible' && <Field label="生图端点" htmlFor="image-endpoint"
            hint="本地 gemini-3.1-flash-image 请选择 Chat Completions；标准图片 API 请选择 Images。">
            <select id="image-endpoint" className="field-input" value={endpoint} disabled={generating || saving}
              onChange={(event) => setEndpoint(event.target.value as typeof endpoint)}>
              <option value="images">Images API · /images/generations</option>
              <option value="chat-completions">Chat Completions · 兼容网关图片扩展</option>
            </select>
          </Field>}
          {settings?.provider === 'gemini' && <p className="field-hint">使用原生 Gemini GenerateContent 图片接口。</p>}
          <Field label="提示词" htmlFor="image-prompt">
            <textarea id="image-prompt" className="field-input image-prompt" rows={8} maxLength={32000}
              value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={generating || saving}
              placeholder="描述你希望生成的图片…" required />
          </Field>
          <div className="image-generation-actions">
            <Button type="submit" disabled={!configured || unsupported || generating || saving || !prompt.trim() || !modelId.trim()}>
              {generating ? '正在生成…' : '生成图片'}
            </Button>
            {generating && <Button variant="secondary" onClick={cancel}>取消生成</Button>}
          </div>
        </form>
        <section className="image-generation-results" aria-label="生成结果" aria-busy={generating}>
          {!result && <div className="image-generation-empty"><h2>图片预览</h2><p>生成后的图片会显示在这里。</p></div>}
          {result && <>
            <h2>生成结果</h2><p className="field-hint">模型：{result.modelId}</p>
            {result.output.text && <p className="image-generation-text">{result.output.text}</p>}
            {result.output.images.map((image, index) => <figure key={`${result.requestId}-${index}`} className="generated-image-card">
              {image.type === 'base64' ? <>
                <img src={`data:${image.mediaType};base64,${image.data}`} alt={`生成图片 ${index + 1}`} />
                <figcaption><Button variant="secondary" disabled={saving || generating} onClick={() => save(index)}>
                  {saving ? '正在保存…' : `保存图片 ${index + 1}`}
                </Button></figcaption>
              </> : <>
                <p>供应商返回图片外链。为保护桌面应用，本版本不自动下载远程文件；请复制链接在浏览器中查看。</p>
                <input aria-label={`图片 ${index + 1} 链接`} className="field-input" readOnly value={image.url} />
              </>}
            </figure>)}
          </>}
        </section>
      </div>
    </div>
  )
}
