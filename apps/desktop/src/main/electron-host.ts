import { app, BrowserWindow, dialog, session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ChatKernel } from 'chat-core'
import { ConversationRuntimeService, InMemoryConversationCursorStore } from 'chat-conversation-runtime'
import { ConversationTreeService } from 'chat-conversation-tree'
import { createModelAdapter } from 'chat-model-adapters'
import {
  loadAppConfig,
  loadLocalDevProviderConfig,
  type AppConfig
} from './app-config.js'
import { registerDesktopShellTransport } from './desktop-shell.transport.js'
import {
  DesktopConversationService,
  MutableConversationModelProvider
} from './conversation/desktop-conversation.service.js'
import { registerConversationTransport } from './conversation/conversation.transport.js'
import { ProviderRuntimeService } from './provider/provider-runtime.service.js'
import { registerProviderTransport } from './provider/provider.transport.js'
import { registerElectronChatTransport } from './electron-transport.js'
import { NavigationPolicy } from './security/navigation-policy.js'
import {
  BROWSER_WINDOW_SECURITY_PREFERENCES,
  buildContentSecurityPolicy
} from './security/security-policy.js'
import { SenderPolicy } from './security/sender-policy.js'

import { GenerationPreferencesService } from './preferences/generation-preferences.service.js'
import { registerPreferencesTransport } from './preferences/preferences.transport.js'
import { DesktopImageGenerationService } from './image-generation/desktop-image-generation.service.js'
import { ImageGenerationTransport } from './image-generation/image-generation.transport.js'
import { DesktopConversationStorage } from './storage/desktop-conversation.storage.js'

export class ElectronHost {
  private mainWindow: BrowserWindow | null = null
  private kernel: ChatKernel | null = null
  private unregisterTransport: (() => void) | null = null
  private unregisterShellTransport: (() => void) | null = null
  private unregisterChatTransport: (() => void) | null = null
  private unregisterConversationTransport: (() => void) | null = null
  private unregisterProviderTransport: (() => void) | null = null
  private unregisterPreferencesTransport: (() => void) | null = null
  private unregisterImageTransport: (() => void) | null = null
  private imageService: DesktopImageGenerationService | null = null
  private conversationModelProvider: MutableConversationModelProvider | null = null
  private navigationPolicy: NavigationPolicy | null = null
  private conversationStorage: DesktopConversationStorage | null = null
  private conversationService: DesktopConversationService | null = null

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

    this.conversationStorage = await DesktopConversationStorage.open(join(app.getPath('userData'), 'conversation-data'))
    const treeService = new ConversationTreeService(this.conversationStorage)
    const cursorStore = new InMemoryConversationCursorStore()
    const selectedNode = this.conversationStorage.getSelection('desktop-conversation-default')
    if (selectedNode) cursorStore.set('desktop-conversation-default', selectedNode)
    const runtime = new ConversationRuntimeService(
      treeService,
      cursorStore,
      undefined,
      this.conversationStorage
    )
    this.conversationModelProvider = new MutableConversationModelProvider()
    let initialProviderConfig: AppConfig['providerConfig'] | undefined
    try {
      initialProviderConfig = loadAppConfig().providerConfig
    } catch {
      // Provider configuration is optional. In explicitly enabled development
      // mode, use the local test provider as the initial runtime.
      if (!app.isPackaged) {
        initialProviderConfig = loadLocalDevProviderConfig()?.providerConfig
      }
    }
    const providerService = new ProviderRuntimeService({
      modelProvider: this.conversationModelProvider,
      initialConfig: initialProviderConfig,
      hasActiveTurn: () => runtime.hasActiveTurn('desktop-conversation-default') || !!this.imageService?.hasActiveRequest(),
      isPackaged: app.isPackaged
    })
    const preferencesService = new GenerationPreferencesService()
    const conversationService = new DesktopConversationService(
      'desktop-conversation-default',
      treeService,
      runtime,
      this.conversationModelProvider,
      preferencesService,
      this.conversationStorage
    )
    this.conversationService = conversationService
    this.unregisterConversationTransport = registerConversationTransport({
      service: conversationService,
      senderPolicy
    })
    this.unregisterProviderTransport = registerProviderTransport(providerService, senderPolicy)
    this.unregisterPreferencesTransport = registerPreferencesTransport(preferencesService, senderPolicy)
    this.imageService = new DesktopImageGenerationService({
      getProviderConfig: () => providerService.getRuntimeConfig(),
      saveImage: async (image, imageIndex) => {
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[image.mediaType]
        const options = {
          title: '保存生成的图片', defaultPath: `generated-image-${imageIndex + 1}.${extension}`,
          filters: [{ name: '图片', extensions: [extension] }]
        }
        const result = this.mainWindow && !this.mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(this.mainWindow, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return false
        await writeFile(result.filePath, Buffer.from(image.data, 'base64'))
        return true
      }
    })
    this.unregisterImageTransport = new ImageGenerationTransport(this.imageService, senderPolicy).register()

    this.setupSecurityHeaders(parsedRendererUrl)
  }

  /**
   * Optional AI runtime initialization for debug chat endpoints.
   */
  public async initializeAiRuntime(customConfig?: AppConfig, rendererUrl?: string): Promise<void> {
    const config = customConfig ?? loadAppConfig()
    const modelAdapter = createModelAdapter(config.providerConfig)

    this.kernel = new ChatKernel(modelAdapter)
    this.conversationModelProvider?.setCurrentModel({
      providerId: config.providerConfig.provider,
      modelId: config.providerConfig.modelId,
      executor: this.kernel
    })
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
      this.imageService?.dispose()
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
    this.unregisterImageTransport?.()
    this.unregisterImageTransport = null
    this.imageService?.dispose()
    await this.conversationService?.shutdown()
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

    if (this.unregisterConversationTransport) {
      this.unregisterConversationTransport()
      this.unregisterConversationTransport = null
    }

    if (this.unregisterProviderTransport) {
      this.unregisterProviderTransport()
      this.unregisterProviderTransport = null
    }

    if (this.unregisterPreferencesTransport) {
      this.unregisterPreferencesTransport()
      this.unregisterPreferencesTransport = null
    }

    await this.conversationStorage?.flush()

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
