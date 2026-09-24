import React from 'react'

export interface FieldProps {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: React.ReactNode
  className?: string
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className = ''
}: FieldProps) {
  return (
    <div className={`field-group ${className}`.trim()}>
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="field-error">
          {error}
        </span>
      )}
    </div>
  )
}
