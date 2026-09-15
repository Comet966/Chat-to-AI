import { app } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronHost } from './electron-host.js'

const host = new ElectronHost()
let isQuitting = false

app.whenReady().then(async () => {
  try {
    await host.initialize()
    const mainDir = dirname(fileURLToPath(import.meta.url))
    const preloadPath = join(mainDir, '../preload/index.mjs')
    const devUrl = process.env.ELECTRON_RENDERER_URL
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
