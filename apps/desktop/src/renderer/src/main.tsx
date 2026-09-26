import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app.js'
import './styles/tokens.css'
import './styles/global.css'
import './styles/layout.css'
import './styles/conversation-tree.css'

const rootElement = document.getElementById('root')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
