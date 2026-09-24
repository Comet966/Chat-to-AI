import { app, BrowserWindow, session } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ChatKernel } from 'chat-core'
import { createModelAdapter } from 'chat-model-adapters'
import { loadAppConfig, type AppConfig } from './app-config.js'
import { registerDesktopShellTransport } from './desktop-shell.transport.js'
import { registerElectronChatTransport } from './electron-transport.js'
import { NavigationPolicy } from './security/navigation-policy.js'
import {
  BROWSER_WINDOW_SECURITY_PREFERENCES,
  buildContentSecurityPolicy
} from './security/security-policy.js'
import { SenderPolicy } from './security/sender-policy.js'

export class ElectronHost {
  private mainWindow: BrowserWindow | null = null
  private kernel: ChatKernel | null = null
  private unregisterTransport: (() => void) | null = null
  private unregisterShellTransport: (() => void) | null = null
  private unregisterChatTransport: (() => void) | null = null
  private navigationPolicy: NavigationPolicy | null = null

  /**
   * Initializes the desktop shell without requiring AI provider credentials.
   */
  public async initialize(rendererUrl?: string): Promise<void> {
    const parsedRendererUrl = this.resolveRendererUrl(rendererUrl)
    const allowedOrigins = [
      parsedRendererUrl.protocol === 'file:'
        ? parsedRendererUrl.href
        : parsedRendererUrl.origin
    ]

    const senderPolicy = new SenderPolicy({ allowedOrigins })
    this.unregisterShellTransport = registerDesktopShellTransport({ senderPolicy })

    this.setupSecurityHeaders(parsedRendererUrl)
  }

  /**
   * Optional AI runtime initialization for debug chat endpoints.
   */
  public async initializeAiRuntime(customConfig?: AppConfig, rendererUrl?: string): Promise<void> {
    const config = customConfig ?? loadAppConfig()
    const modelAdapter = createModelAdapter(config.providerConfig)

    this.kernel = new ChatKernel(modelAdapter)
    const parsedRendererUrl = rendererUrl ? new URL(rendererUrl) : null
    this.unregisterChatTransport = registerElectronChatTransport({
      kernel: this.kernel,
      allowedOrigins: parsedRendererUrl && parsedRendererUrl.protocol !== 'file:'
        ? [parsedRendererUrl.origin]
        : undefined
    })
  }

  public createWindow(preloadPath: string, rendererUrl?: string): BrowserWindow {
    const window = new BrowserWindow({
      width: 1024,
      height: 768,
      show: false,
      webPreferences: {
        preload: preloadPath,
        ...BROWSER_WINDOW_SECURITY_PREFERENCES
      }
    })

    this.mainWindow = window

    // Disallow external window opening
    window.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' }
    })

    const allowedUrl = this.resolveRendererUrl(rendererUrl)
    this.navigationPolicy = new NavigationPolicy(allowedUrl)

    // Disallow navigation outside the configured renderer page/origin.
    window.webContents.on('will-navigate', (event, navigationUrl) => {
      if (!this.navigationPolicy || !this.navigationPolicy.isAllowedNavigation(navigationUrl)) {
        event.preventDefault()
      }
    })

    window.on('closed', () => {
      this.mainWindow = null
    })

    window.once('ready-to-show', () => {
      window.show()
    })

    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        if (!isMainFrame) {
          return
        }

        // Do not include the URL here: production URLs disclose local installation paths.
        console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`)
        if (!window.isDestroyed()) {
          window.destroy()
        }
        app.quit()
      }
    )

    if (rendererUrl && !rendererUrl.startsWith('file:')) {
      window.loadURL(rendererUrl)
    } else {
      const mainDir = dirname(fileURLToPath(import.meta.url))
      const rendererPath = join(mainDir, '../renderer/index.html')
      window.loadFile(rendererPath)
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

    if (this.unregisterShellTransport) {
      this.unregisterShellTransport()
      this.unregisterShellTransport = null
    }

    if (this.unregisterChatTransport) {
      this.unregisterChatTransport()
      this.unregisterChatTransport = null
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy()
      this.mainWindow = null
    }
  }

  private setupSecurityHeaders(rendererUrl: URL | null): void {
    const csp = buildContentSecurityPolicy(rendererUrl)

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })
  }

  private resolveRendererUrl(rendererUrl?: string): URL {
    if (rendererUrl) {
      return new URL(rendererUrl)
    }

    const mainDir = dirname(fileURLToPath(import.meta.url))
    return pathToFileURL(join(mainDir, '../renderer/index.html'))
  }
}
