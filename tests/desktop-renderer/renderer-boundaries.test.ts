import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

function scanFiles(dir: string, callback: (file: string, content: string) => void): void {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'out') {
        scanFiles(fullPath, callback)
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8')
      callback(fullPath, content)
    }
  }
}

describe('Desktop Renderer Architecture Boundaries', () => {
  it('should not import electron, chat-core, or model adapters in renderer code', () => {
    const rendererDir = path.join(rootDir, 'apps/desktop/src/renderer')
    const forbiddenImports = [
      'electron',
      'chat-core',
      'chat-model-adapters',
      'chat-conversation-tree',
      'chat-conversation-runtime'
    ]

    scanFiles(rendererDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      for (const forbidden of forbiddenImports) {
        const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
        expect(regex.test(content), `${relPath} must not import ${forbidden}`).toBe(false)
      }
    })
  })

  it('should not import electron, react, or node-specific modules in shared contract code', () => {
    const sharedDir = path.join(rootDir, 'apps/desktop/src/shared')
    const forbiddenShared = [
      'electron',
      'react',
      'react-dom',
      'node:fs',
      'node:path',
      'node:process',
      'fs',
      'path'
    ]

    scanFiles(sharedDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      for (const forbidden of forbiddenShared) {
        const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
        expect(regex.test(content), `${relPath} must not import ${forbidden}`).toBe(false)
      }
    })
  })

  it('should not import renderer components in main process code', () => {
    const mainDir = path.join(rootDir, 'apps/desktop/src/main')

    scanFiles(mainDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      const importRegex = /from\s+['"][^'"]*renderer[^'"]*['"]/g
      expect(importRegex.test(content), `${relPath} must not import renderer files`).toBe(false)
    })
  })

  it('should not import xyflow, dagre, electron, or core in UI port code', () => {
    const portsDir = path.join(rootDir, 'apps/desktop/src/renderer/src/ports')
    const forbiddenPortImports = [
      '@xyflow/react',
      '@dagrejs/dagre',
      'electron',
      'chat-core',
      'chat-conversation-tree',
      'chat-conversation-runtime',
      'chat-model-adapters'
    ]

    scanFiles(portsDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      for (const forbidden of forbiddenPortImports) {
        const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
        expect(regex.test(content), `${relPath} must not import ${forbidden}`).toBe(false)
      }
    })
  })

  it('should not use JSX inline styles in renderer components (CSP compliance)', () => {
    const rendererDir = path.join(rootDir, 'apps/desktop/src/renderer')

    scanFiles(rendererDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      if (file.endsWith('.tsx')) {
        const styleRegex = /style\s*=\s*\{/g
        expect(styleRegex.test(content), `${relPath} must not contain JSX inline style attributes`).toBe(false)
      }
    })
  })
})
