/// <reference types="vite/client" />
import type { DesktopApi } from '../../shared/desktop-api.contract.js'

interface ImportMetaEnv {
  readonly VITE_DESKTOP_VISUAL_REVIEW?: 'conversation-tree'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}
