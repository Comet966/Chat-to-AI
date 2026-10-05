import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronHost } from './electron-host.js'

const host = new ElectronHost()
let isQuitting = false

app.whenReady().then(async () => {
  try {
    const mainDir = dirname(fileURLToPath(import.meta.url))
    const preloadPath = join(mainDir, '../preload/index.js')
    if (!existsSync(preloadPath)) {
      throw new Error('Sandbox-compatible preload bundle was not found')
    }
    const devUrl = process.env.ELECTRON_RENDERER_URL
    await host.initialize(devUrl)
    host.createWindow(preloadPath, devUrl)
  } catch (err) {
    console.error('Failed to initialize Electron application:', err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (isQuitting) {
    return
  }

  event.preventDefault()
  isQuitting = true

  void host.shutdown().finally(() => {
    app.quit()
  })
})
