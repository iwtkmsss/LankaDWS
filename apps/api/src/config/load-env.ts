import { isAbsolute, resolve } from 'node:path'
import { config } from 'dotenv'

interface EnvPathOptions {
  cwd?: string
  initCwd?: string
  explicitPath?: string
}

export function resolveEnvFiles(options: EnvPathOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd()
  const initCwd = options.initCwd ?? process.env.INIT_CWD
  const explicitPath = options.explicitPath ?? process.env.DOTENV_CONFIG_PATH
  const candidates = [
    explicitPath ? (isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath)) : undefined,
    initCwd ? resolve(initCwd, '.env') : undefined,
    resolve(cwd, '.env'),
    resolve(cwd, '..', '..', '.env'),
  ]
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))]
}

config({ path: resolveEnvFiles(), quiet: true })
