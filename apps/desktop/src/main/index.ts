import { app } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronHost } from './electron-host.js'

const host = new ElectronHost()

app.whenReady().then(async () => {
  try {
    await host.initialize()
    const preloadPath = join(fileURLToPath(import.meta.url), '../../preload/index.js')
    const devUrl = process.env.VITE_DEV_SERVER_URL
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

app.on('before-quit', () => {
  host.shutdown()
})
