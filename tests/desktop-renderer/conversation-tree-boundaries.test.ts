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

describe('Conversation Tree Architecture Boundaries', () => {
  it('UI Port must not import @xyflow/react or @dagrejs/dagre', () => {
    const portDir = path.join(rootDir, 'apps/desktop/src/renderer/src/ports')
    const forbiddenInPorts = ['@xyflow/react', '@dagrejs/dagre', 'electron', 'chat-core', 'chat-conversation-tree']

    scanFiles(portDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      for (const forbidden of forbiddenInPorts) {
        const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
        expect(regex.test(content), `${relPath} must not import ${forbidden}`).toBe(false)
      }
    })
  })

  it('Session tree features must not import electron, chat-core, or conversation-tree packages', () => {
    const sessionTreeDir = path.join(rootDir, 'apps/desktop/src/renderer/src/features/session-tree')
    const forbidden = [
      'electron',
      'chat-core',
      'chat-conversation-tree',
      'chat-conversation-runtime',
      'chat-model-adapters'
    ]

    scanFiles(sessionTreeDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      for (const pkg of forbidden) {
        const regex = new RegExp(`from\\s+['"]${pkg}(/.*)?['"]`, 'g')
        expect(regex.test(content), `${relPath} must not import ${pkg}`).toBe(false)
      }
    })
  })

  it('Demo adapter must not make network calls or import fetch/electron/core packages', () => {
    const adapterPath = path.join(
      rootDir,
      'apps/desktop/src/renderer/src/adapters/demo-conversation-tree-ui.adapter.ts'
    )
    const content = fs.readFileSync(adapterPath, 'utf8')

    expect(content).not.toContain('fetch(')
    expect(content).not.toContain('XMLHttpRequest')
    expect(content).not.toContain('electron')
    expect(content).not.toContain('chat-core')
    expect(content).not.toContain('chat-conversation-tree')
  })

  it('No JSX inline styles in session tree components', () => {
    const sessionTreeDir = path.join(rootDir, 'apps/desktop/src/renderer/src/features/session-tree')

    scanFiles(sessionTreeDir, (file, content) => {
      const relPath = path.relative(rootDir, file)
      if (file.endsWith('.tsx')) {
        const styleRegex = /style\s*=\s*\{/g
        expect(styleRegex.test(content), `${relPath} must not contain JSX inline style attributes`).toBe(false)
      }
    })
  })
})
