import React from 'react'
import ReactDOM from 'react-dom/client'
import { DebugApp } from './debug-app.js'

const rootElement = document.getElementById('root')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <DebugApp />
    </React.StrictMode>
  )
}
