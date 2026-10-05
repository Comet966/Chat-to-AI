import React from 'react'

export interface StatusNoticeProps {
  type?: 'info' | 'warning' | 'success' | 'danger'
  message: string
  className?: string
}

export function StatusNotice({
  type = 'info',
  message,
  className = ''
}: StatusNoticeProps) {
  return (
    <div
      role="status"
      className={`status-notice status-notice-${type} ${className}`.trim()}
    >
      <span>{message}</span>
    </div>
  )
}
