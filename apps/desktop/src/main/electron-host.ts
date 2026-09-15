import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { ChatKernel } from 'chat-core'
import { loadAppConfig, type AppConfig } from './app-config.js'
import { registerElectronChatTransport } from './electron-transport.js'
import { OpenAICompatibleModelAdapter } from './openai-compatible-model.adapter.js'

export class ElectronHost {
  private mainWindow: BrowserWindow | null = null
  private kernel: ChatKernel | null = null
  private unregisterTransport: (() => void) | null = null

  public async initialize(customConfig?: AppConfig): Promise<void> {
    const config = customConfig ?? loadAppConfig()
    const modelAdapter = new OpenAICompatibleModelAdapter({
      baseUrl: config.aiApiBaseUrl,
      apiKey: config.aiApiKey,
      modelId: config.aiModelId
    })

    this.kernel = new ChatKernel(modelAdapter)
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    const parsedRendererUrl = rendererUrl ? new URL(rendererUrl) : null
    this.unregisterTransport = registerElectronChatTransport({
      kernel: this.kernel,
      allowedOrigins: parsedRendererUrl && parsedRendererUrl.protocol !== 'file:' ? [parsedRendererUrl.origin] : undefined
    })

    this.setupSecurityHeaders()
  }

  public createWindow(preloadPath: string, rendererUrl?: string): BrowserWindow {
    const window = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })

    this.mainWindow = window

    // Disallow external window opening
    window.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' }
    })

    const allowedRendererUrl = rendererUrl ? new URL(rendererUrl) : null

    // Disallow navigation outside the configured renderer page/origin.
    window.webContents.on('will-navigate', (event, navigationUrl) => {
      if (!allowedRendererUrl || !this.isAllowedNavigation(navigationUrl, allowedRendererUrl)) {
        event.preventDefault()
      }
    })

    window.on('closed', () => {
      this.mainWindow = null
    })

    window.once('ready-to-show', () => {
      window.show()
    })

    if (rendererUrl) {
      window.loadURL(rendererUrl)
    }

    return window
  }

  public async shutdown(): Promise<void> {
    const activeRequestId = this.kernel?.getState().activeRequestId
    if (activeRequestId) {
      await this.kernel?.cancel({ requestId: activeRequestId })
    }

    if (this.unregisterTransport) {
      this.unregisterTransport()
      this.unregisterTransport = null
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy()
      this.mainWindow = null
    }
  }

  private setupSecurityHeaders(): void {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"
          ]
        }
      })
    })
  }

  private isAllowedNavigation(navigationUrl: string, allowedRendererUrl: URL): boolean {
    try {
      const targetUrl = new URL(navigationUrl)
      if (allowedRendererUrl.protocol === 'file:') {
        return targetUrl.protocol === 'file:' && targetUrl.pathname === allowedRendererUrl.pathname
      }
      return targetUrl.origin === allowedRendererUrl.origin
    } catch {
      return false
    }
  }
}
