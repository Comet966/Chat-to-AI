/// <reference types="vite/client" />
import type { DesktopApi } from '../../shared/desktop-api.contract.js'

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}
