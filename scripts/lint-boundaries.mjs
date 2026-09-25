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
  'axios',
  'chat-conversation-tree',
  'chat-conversation-runtime',
  'conversation-tree',
  'conversation-runtime'
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
    if (dep.includes('electron') || dep.includes('react') || dep.includes('zustand') || dep.includes('conversation')) {
      errors.push(`packages/chat-core has forbidden dependency: "${dep}". Electron/React/Zustand/Conversation are prohibited.`)
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
    if (dep.includes('electron') || dep.includes('react') || dep.includes('zustand') || dep.includes('conversation')) {
      errors.push(`packages/chat-contracts has forbidden dependency: "${dep}".`)
    }
  }
}

function checkModelAdaptersPackageJson() {
  const pkgPath = path.join(rootDir, 'packages', 'chat-model-adapters', 'package.json')
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})

  for (const dep of [...deps, ...devDeps]) {
    if (dep.includes('electron') || dep.includes('react') || dep.includes('zustand') || dep.includes('conversation')) {
      errors.push(`packages/chat-model-adapters has forbidden dependency: "${dep}".`)
    }
  }
}

function checkConversationTreePackageJson() {
  const pkgPath = path.join(rootDir, 'packages', 'conversation-tree', 'package.json')
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})

  if (deps.length > 0) {
    errors.push(`packages/conversation-tree must have zero production dependencies, found: ${deps.join(', ')}`)
  }

  for (const dep of devDeps) {
    if (dep !== 'typescript') {
      errors.push(`packages/conversation-tree has forbidden devDependency: "${dep}". Only "typescript" is permitted.`)
    }
  }
}

function checkConversationRuntimePackageJson() {
  const pkgPath = path.join(rootDir, 'packages', 'conversation-runtime', 'package.json')
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})

  const allowedDeps = ['chat-contracts', 'chat-conversation-tree']
  for (const dep of deps) {
    if (!allowedDeps.includes(dep)) {
      errors.push(`packages/conversation-runtime has forbidden production dependency: "${dep}". Allowed: ${allowedDeps.join(', ')}`)
    }
  }

  for (const dep of devDeps) {
    if (dep !== 'typescript') {
      errors.push(`packages/conversation-runtime has forbidden devDependency: "${dep}". Only "typescript" is permitted.`)
    }
  }
}

function checkConversationTreeSourceFiles() {
  const treeSrc = path.join(rootDir, 'packages', 'conversation-tree', 'src')
  if (!fs.existsSync(treeSrc)) return

  const FORBIDDEN_TREE_IMPORTS = [
    'electron',
    'react',
    'zustand',
    'chat-core',
    'chat-contracts',
    'chat-model-adapters',
    'chat-conversation-runtime',
    'http',
    'https',
    'undici',
    'axios'
  ]

  const FORBIDDEN_TREE_SYMBOLS = [
    'OpenAICompatibleModelAdapter',
    'AnthropicMessagesModelAdapter',
    'GeminiGenerateContentModelAdapter',
    'ChatKernel',
    'ChatModelPort',
    'fetch',
    'AbortController',
    'ipcMain',
    'ipcRenderer',
    'BrowserWindow'
  ]

  scanDir(treeSrc, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    for (const forbidden of FORBIDDEN_TREE_IMPORTS) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: conversation-tree must not import "${forbidden}"`)
      }
    }

    for (const sym of FORBIDDEN_TREE_SYMBOLS) {
      const regex = new RegExp(`\\b${sym}\\b`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: conversation-tree must not use symbol "${sym}"`)
      }
    }
  })
}

function checkConversationRuntimeSourceFiles() {
  const runtimeSrc = path.join(rootDir, 'packages', 'conversation-runtime', 'src')
  if (!fs.existsSync(runtimeSrc)) return

  const FORBIDDEN_RUNTIME_IMPORTS = [
    'electron',
    'react',
    'zustand',
    'readline',
    'node:readline',
    'http',
    'https',
    'undici',
    'axios'
  ]

  const FORBIDDEN_CONCRETE_ADAPTERS = [
    'OpenAICompatibleModelAdapter',
    'AnthropicMessagesModelAdapter',
    'GeminiGenerateContentModelAdapter'
  ]

  scanDir(runtimeSrc, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    for (const forbidden of FORBIDDEN_RUNTIME_IMPORTS) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: conversation-runtime must not import "${forbidden}"`)
      }
    }

    for (const adapter of FORBIDDEN_CONCRETE_ADAPTERS) {
      const regex = new RegExp(`\\b${adapter}\\b`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: conversation-runtime must not use concrete adapter "${adapter}"`)
      }
    }
  })
}

function checkDesktopAndDebugRendererDoNotImportRuntimeOrTree() {
  const forbiddenDirs = [
    path.join(rootDir, 'apps', 'desktop', 'src'),
    path.join(rootDir, 'apps', 'debug-renderer', 'src')
  ]

  const forbiddenPackages = [
    'chat-conversation-tree',
    'conversation-tree',
    'chat-conversation-runtime',
    'conversation-runtime'
  ]

  for (const dir of forbiddenDirs) {
    scanDir(dir, (filePath) => {
      const content = fs.readFileSync(filePath, 'utf8')
      const relPath = path.relative(rootDir, filePath)

      for (const pkg of forbiddenPackages) {
        const importRegex = new RegExp(`from\\s+['"]${pkg}(/.*)?['"]|require\\(['"]${pkg}(/.*)?['"]\\)`, 'g')
        if (importRegex.test(content)) {
          errors.push(`${relPath}: desktop and debug-renderer must not integrate "${pkg}" in this phase.`)
        }
      }
    })
  }
}

function scanDir(dirPath, handler) {
  if (!fs.existsSync(dirPath)) return
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'out') {
        scanDir(fullPath, handler)
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.mjs'))) {
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

function checkTestCliIfPresent() {
  const cliPkgPath = path.join(rootDir, 'apps', 'test-cli', 'package.json')
  if (!fs.existsSync(cliPkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(cliPkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})

  for (const dep of [...deps, ...devDeps]) {
    if (dep.includes('electron') || dep.includes('react') || dep.includes('zustand') || dep.includes('desktop')) {
      errors.push(`apps/test-cli has forbidden dependency: "${dep}". Electron/React/Desktop are prohibited.`)
    }
  }

  const cliSrc = path.join(rootDir, 'apps', 'test-cli', 'src')
  scanDir(cliSrc, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    const forbiddenImports = ['electron', 'react', 'zustand']
    for (const forbidden of forbiddenImports) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: test-cli must not import "${forbidden}"`)
      }
    }

    if (content.includes('ipcRenderer') || content.includes('ipcMain') || content.includes('BrowserWindow')) {
      errors.push(`${relPath}: test-cli must not reference Electron symbols`)
    }
  })
}

function checkCallersDoNotImportConcreteAdapters() {
  const callerDirs = [
    path.join(rootDir, 'apps', 'test-cli', 'src'),
    path.join(rootDir, 'apps', 'desktop', 'src')
  ]
  const concreteAdapters = [
    'OpenAICompatibleModelAdapter',
    'AnthropicMessagesModelAdapter',
    'GeminiGenerateContentModelAdapter'
  ]

  for (const dir of callerDirs) {
    scanDir(dir, (filePath) => {
      const content = fs.readFileSync(filePath, 'utf8')
      const relPath = path.relative(rootDir, filePath)

      for (const adapter of concreteAdapters) {
        const importRegex = new RegExp(`import\\s+[^;]*\\b${adapter}\\b[^;]*from`, 'g')
        if (importRegex.test(content)) {
          errors.push(`${relPath}: callers must not import concrete adapter "${adapter}" directly; use "createModelAdapter" factory instead.`)
        }
      }
    })
  }
}

function checkDesktopRendererBoundaries() {
  const rendererDir = path.join(rootDir, 'apps', 'desktop', 'src', 'renderer')
  if (!fs.existsSync(rendererDir)) return

  const forbiddenRendererImports = [
    'electron',
    'chat-core',
    'chat-model-adapters',
    'chat-conversation-tree',
    'chat-conversation-runtime'
  ]

  scanDir(rendererDir, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    for (const forbidden of forbiddenRendererImports) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: desktop renderer must not import "${forbidden}"`)
      }
    }
  })
}

function checkDesktopSharedBoundaries() {
  const sharedDir = path.join(rootDir, 'apps', 'desktop', 'src', 'shared')
  if (!fs.existsSync(sharedDir)) return

  const forbiddenSharedImports = [
    'electron',
    'react',
    'react-dom',
    'node:fs',
    'node:path',
    'node:process',
    'fs',
    'path'
  ]

  scanDir(sharedDir, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    for (const forbidden of forbiddenSharedImports) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: desktop shared contract must not import "${forbidden}"`)
      }
    }
  })
}

function checkDesktopMainDoesNotImportRenderer() {
  const mainDir = path.join(rootDir, 'apps', 'desktop', 'src', 'main')
  if (!fs.existsSync(mainDir)) return

  scanDir(mainDir, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    const importRegex = /from\s+['"][^'"]*renderer[^'"]*['"]/g
    if (importRegex.test(content)) {
      errors.push(`${relPath}: main process must not import from renderer`)
    }
  })
}

function checkDesktopPortBoundaries() {
  const portsDir = path.join(rootDir, 'apps', 'desktop', 'src', 'renderer', 'src', 'ports')
  if (!fs.existsSync(portsDir)) return

  const forbiddenPortImports = [
    '@xyflow/react',
    '@dagrejs/dagre',
    'electron',
    'chat-core',
    'chat-conversation-tree',
    'chat-conversation-runtime',
    'chat-model-adapters'
  ]

  scanDir(portsDir, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(rootDir, filePath)

    for (const forbidden of forbiddenPortImports) {
      const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g')
      if (regex.test(content)) {
        errors.push(`${relPath}: UI port must not import "${forbidden}"`)
      }
    }
  })
}

checkCorePackageJson()
checkContractsPackageJson()
checkModelAdaptersPackageJson()
checkConversationTreePackageJson()
checkConversationRuntimePackageJson()
checkCoreSourceFiles()
checkDebugRendererIfPresent()
checkTestCliIfPresent()
checkConversationTreeSourceFiles()
checkConversationRuntimeSourceFiles()
checkDesktopAndDebugRendererDoNotImportRuntimeOrTree()
checkCallersDoNotImportConcreteAdapters()
checkDesktopRendererBoundaries()
checkDesktopSharedBoundaries()
checkDesktopMainDoesNotImportRenderer()
checkDesktopPortBoundaries()

if (errors.length > 0) {
  console.error('Architecture boundary violations found:')
  for (const err of errors) {
    console.error(` - ${err}`)
  }
  process.exit(1)
} else {
  console.log('Boundary lint passed: all architecture constraints satisfied.')
}
