import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts']
  },
  resolve: {
    alias: {
      'chat-contracts': resolve(__dirname, 'packages/chat-contracts/src/index.ts'),
      'chat-core': resolve(__dirname, 'packages/chat-core/src/index.ts'),
      'chat-model-adapters': resolve(__dirname, 'packages/chat-model-adapters/src/index.ts')
    }
  }
})
