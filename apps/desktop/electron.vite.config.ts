import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    // Sandboxed preloads cannot load arbitrary external packages at runtime.
    // Bundle contract validation dependencies and leave Electron itself external.
    plugins: [externalizeDepsPlugin({ exclude: ['zod', 'chat-contracts'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        output: {
          // Sandboxed Electron preloads do not support native ESM imports.
          // Keep the bridge in one synchronous CommonJS file so it is ready
          // before the renderer evaluates window.desktopApi.
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          inlineDynamicImports: true
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
