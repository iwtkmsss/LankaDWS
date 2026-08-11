import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(currentFile)
const projectRoot = path.resolve(scriptDir, '..')
const publicEnvFile = resolveEnvFile(process.env.PUBLIC_ENV_FILE || '.env.public')

loadEnvFile(publicEnvFile)

const mode = process.argv[2] ?? 'preview'
const clientPort = Number(process.env.CLIENT_PORT || process.env.PUBLIC_CLIENT_PORT) || 5173
const serverPort = Number(process.env.PORT || process.env.SERVER_PORT || process.env.PUBLIC_SERVER_PORT) || 3000

function resolveEnvFile(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath)
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (!match) continue

    const [, key, rawValue] = match
    if (Object.hasOwn(process.env, key)) continue
    process.env[key] = parseEnvValue(rawValue)
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) return value.slice(1, -1)
  return value.replace(/\s+#.*$/u, '').trim()
}

function detectIpv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.')) return address.address
    }
  }
  return '127.0.0.1'
}

const publicHost = process.env.PUBLIC_HOST || detectIpv4()
const clientUrl = `http://${publicHost}:${clientPort}`
const apiUrl = `http://${publicHost}:${serverPort}`
const clientOrigin = [clientUrl, `http://localhost:${clientPort}`, `http://127.0.0.1:${clientPort}`].join(',')

const publicEnv = {
  ...process.env,
  HOST: '0.0.0.0',
  PORT: String(serverPort),
  VITE_API_URL: apiUrl,
  VITE_API_PROXY_TARGET: 'http://127.0.0.1:' + serverPort,
  FRONTEND_BASE_URL: clientUrl,
  FRONTEND_ORIGIN: clientOrigin,
}

function printUrls() {
  if (fs.existsSync(publicEnvFile)) console.log(`Loaded public env: ${publicEnvFile}`)
  console.log(`Public URL: ${clientUrl}`)
  console.log(`API URL: ${apiUrl}/api/v1`)
  console.log('Tip: edit .env.public or set PUBLIC_HOST manually if another host is needed.')
}

function spawnLongRunning(command, args) {
  const isWindows = process.platform === 'win32'
  const executable = isWindows ? commandLine(command, args) : command
  const child = spawn(executable, isWindows ? [] : args, {
    env: publicEnv,
    stdio: 'inherit',
    shell: isWindows,
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

function quoteArg(value) {
  const text = String(value)
  return /[\s"]/u.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

function commandLine(command, args) {
  return [command, ...args.map(quoteArg)].join(' ')
}

printUrls()

if (mode === 'dev') {
  spawnLongRunning('npx', [
    'concurrently', '-n', 'api,web', '-c', 'cyan,magenta',
    'npm run dev:public --workspace @bert-crm/api',
    `npm run dev:public --workspace @bert-crm/web -- --port ${clientPort}`,
  ])
} else {
  console.error(`Unknown public runner mode: ${mode}`)
  process.exit(1)
}
