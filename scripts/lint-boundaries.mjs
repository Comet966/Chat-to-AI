import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const FORBIDDEN_CORE_IMPORTS = [
  'electron',
  'react',
  'zustand',
  'openai',
  '@anthropic-ai',
  'http',
  'https',
  'undici',
  'axios'
]

const FORBIDDEN_KEYWORDS_IN_CORE = [
  'ipcRenderer',
  'ipcMain',
  'BrowserWindow',
  'window.'
]

let errors = []

function checkCorePackageJson() {
  const pkgPath = path.join(rootDir, 'packages', 'chat-core', 'package.json')
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})

  for (const dep of deps) {
    if (dep !== 'chat-contracts') {
      errors.push(`packages/chat-core has forbidden production dependency: "${dep}". Only "chat-contracts" is permitted.`)
    }
  }

  for (const dep of [...deps, ...devDeps]) {
    if (dep.includes('electron') || dep.includes('react') || dep.includes('zustand')) {
      errors.push(`packages/chat-core has forbidden dependency: "${dep}". Electron/React/Zustand are prohibited.`)
    }
  }
}

function checkContractsPackageJson() {
  const pkgPath = path.join(rootDir, 'packages', 'chat-contracts', 'package.json')
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})

  for (const dep of [...deps, ...devDeps]) {
    if (dep.includes('electron') || dep.includes('react') || dep.includes('zustand')) {
      errors.push(`packages/chat-contracts has forbidden dependency: "${dep}".`)
    }
  }
}

function scanDir(dirPath, handler) {
  if (!fs.existsSync(dirPath)) return
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        scanDir(fullPath, handler)
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      handler(fullPath)
    }
  }
}

function checkCoreSourceFiles() {
  const coreSrc = path.join(rootDir, 'packages', 'chat-core', 'src')
  scanDir(coreSrc, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    for (const forbidden of FORBIDDEN_CORE_IMPORTS) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: forbidden import from "${forbidden}"`)
      }
    }

    for (const kw of FORBIDDEN_KEYWORDS_IN_CORE) {
      if (content.includes(kw)) {
        errors.push(`${relPath}: forbidden keyword or symbol "${kw}" found in core source`)
      }
    }
  })
}

function checkDebugRendererIfPresent() {
  const rendererPkgPath = path.join(rootDir, 'apps', 'debug-renderer', 'package.json')
  if (!fs.existsSync(rendererPkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(rendererPkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  if (deps.includes('chat-core')) {
    errors.push(`apps/debug-renderer must not depend on chat-core`)
  }

  const rendererSrc = path.join(rootDir, 'apps', 'debug-renderer', 'src')
  scanDir(rendererSrc, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)
    if (content.includes('chat-core')) {
      errors.push(`${relPath}: debug-renderer must not import chat-core`)
    }
  })
}

checkCorePackageJson()
checkContractsPackageJson()
checkCoreSourceFiles()
checkDebugRendererIfPresent()

if (errors.length > 0) {
  console.error('Architecture boundary violations found:')
  for (const err of errors) {
    console.error(` - ${err}`)
  }
  process.exit(1)
} else {
  console.log('Boundary lint passed: all architecture constraints satisfied.')
}
