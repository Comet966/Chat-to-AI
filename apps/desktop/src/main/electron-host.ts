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
    this.unregisterTransport = registerElectronChatTransport({
      kernel: this.kernel
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

    // Disallow navigation to external URLs
    window.webContents.on('will-navigate', (event, navigationUrl) => {
      if (!navigationUrl.startsWith('http://localhost:') && !navigationUrl.startsWith('file://')) {
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

  public shutdown(): void {
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
}
