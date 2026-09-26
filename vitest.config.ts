import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/desktop-renderer/**', 'jsdom']
    ],
    setupFiles: ['tests/setup-jsdom.ts'],
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']
  },
  resolve: {
    alias: {
      'chat-contracts': resolve(__dirname, 'packages/chat-contracts/src/index.ts'),
      'chat-core': resolve(__dirname, 'packages/chat-core/src/index.ts'),
      'chat-model-adapters': resolve(__dirname, 'packages/chat-model-adapters/src/index.ts'),
      'chat-conversation-tree': resolve(__dirname, 'packages/conversation-tree/src/index.ts'),
      'chat-conversation-runtime': resolve(__dirname, 'packages/conversation-runtime/src/index.ts')
    }
  }
})
