import React from 'react'
import type { MessageRenderMode } from './MessageContent.js'

export interface RenderModeToggleProps {
  mode: MessageRenderMode
  onChange: (mode: MessageRenderMode) => void
}

const modes: ReadonlyArray<{ value: MessageRenderMode; label: string }> = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' }
]

export function RenderModeToggle({ mode, onChange }: RenderModeToggleProps) {
  return (
    <div className="render-mode-toggle" role="group" aria-label="回复渲染模式">
      {modes.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`render-mode-option ${mode === option.value ? 'active' : ''}`.trim()}
          aria-pressed={mode === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
