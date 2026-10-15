import React, { useEffect, useState } from 'react'
import { Button } from '../../components/Button.js'
import { Field } from '../../components/Field.js'
import { StatusNotice } from '../../components/StatusNotice.js'
import type { GenerationPreferencesPort } from '../../ports/generation-preferences.port.js'
import {
  DEFAULT_GENERATION_PREFERENCES,
  type GenerationPreferencesDto,
  type OutputFormat
} from '../../../../shared/preferences.contract.js'

export interface OutputPreferencesFormProps {
  port: GenerationPreferencesPort
}

export function OutputPreferencesForm({ port }: OutputPreferencesFormProps) {
  const [preferences, setPreferences] = useState<GenerationPreferencesDto>(DEFAULT_GENERATION_PREFERENCES)
  const [activeFormat, setActiveFormat] = useState<OutputFormat>('markdown')
  const [markdownTemplate, setMarkdownTemplate] = useState(DEFAULT_GENERATION_PREFERENCES.markdownTemplate)
  const [htmlTemplate, setHtmlTemplate] = useState(DEFAULT_GENERATION_PREFERENCES.htmlTemplate)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    void port.getPreferences().then((res) => {
      if (isMounted && res.ok) {
        setPreferences(res.value)
        setActiveFormat(res.value.activeFormat)
        setMarkdownTemplate(res.value.markdownTemplate)
        setHtmlTemplate(res.value.htmlTemplate)
      }
    })
    return () => {
      isMounted = false
    }
  }, [port])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('saving')
    const res = await port.savePreferences({
      activeFormat,
      markdownTemplate,
      htmlTemplate
    })
    if (res.ok) {
      setStatus('saved')
      setMessage('输出格式提示词已更新，将在下一轮请求中注入生效。')
    } else {
      setStatus('error')
      setMessage(res.error.message)
    }
  }

  const handleReset = () => {
    setMarkdownTemplate(DEFAULT_GENERATION_PREFERENCES.markdownTemplate)
    setHtmlTemplate(DEFAULT_GENERATION_PREFERENCES.htmlTemplate)
    setActiveFormat('markdown')
    setMessage('已恢复为默认提示词，请点击保存以应用。')
    setStatus('idle')
  }

  return (
    <form onSubmit={handleSubmit} className="card preferences-card" noValidate>
      <h2 className="card-title">输出格式与系统提示词 · Output Format Policy</h2>
      <p className="card-subtitle">
        配置模型回复的输出格式约束系统提示词。注意：系统提示词用于引导模型输出风格，最终安全仍由本地渲染 Sanitizer 严格保障。
      </p>

      {message && (
        <StatusNotice
          type={status === 'saved' ? 'success' : status === 'error' ? 'danger' : 'info'}
          message={message}
        />
      )}

      <div className="form-section">
        <h3 className="form-section-title">默认输出格式 · Default Output Format</h3>
        <Field label="Active Format" htmlFor="active-format">
          <div className="render-mode-toggle" role="group" aria-label="输出格式">
            <button
              type="button"
              className={`render-mode-option ${activeFormat === 'markdown' ? 'active' : ''}`.trim()}
              aria-pressed={activeFormat === 'markdown'}
              onClick={() => setActiveFormat('markdown')}
            >
              Markdown
            </button>
            <button
              type="button"
              className={`render-mode-option ${activeFormat === 'html' ? 'active' : ''}`.trim()}
              aria-pressed={activeFormat === 'html'}
              onClick={() => setActiveFormat('html')}
            >
              HTML
            </button>
          </div>
        </Field>
      </div>

      <div className="form-section">
        <h3 className="form-section-title">Markdown 约束系统提示词</h3>
        <Field
          label="Markdown Prompt Template"
          htmlFor="markdown-template"
          hint="注入到模型 System Message 中，要求模型只输出 CommonMark / GFM 语法与 LaTeX 数学公式"
        >
          <textarea
            id="markdown-template"
            rows={4}
            value={markdownTemplate}
            onChange={(e) => setMarkdownTemplate(e.target.value)}
            className="field-textarea"
          />
        </Field>
      </div>

      <div className="form-section">
        <h3 className="form-section-title">HTML 约束系统提示词</h3>
        <Field
          label="HTML Prompt Template"
          htmlFor="html-template"
          hint="支持安全语义组件与静态 SVG；仅在明确需要时生成小型脚本，并由用户手动在无网络隔离沙箱中运行"
        >
          <textarea
            id="html-template"
            rows={4}
            value={htmlTemplate}
            onChange={(e) => setHtmlTemplate(e.target.value)}
            className="field-textarea"
          />
        </Field>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary">
          Save Preferences
        </Button>
        <Button type="button" variant="secondary" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </div>
    </form>
  )
}
