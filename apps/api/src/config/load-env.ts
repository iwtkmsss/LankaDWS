import { basename, dirname, resolve } from 'node:path'
import { config } from 'dotenv'

interface EnvPathOptions {
  cwd?: string
  initCwd?: string
}

function resolveRepositoryRoot(start: string): string {
  const absolute = resolve(start)
  return basename(dirname(absolute)) === 'apps'
    ? resolve(absolute, '..', '..')
    : absolute
}

export function resolveEnvFiles(options: EnvPathOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd()
  const initCwd = options.initCwd ?? process.env.INIT_CWD
  const repositoryRoot = resolveRepositoryRoot(initCwd || cwd)
  return [resolve(repositoryRoot, '.env')]
}

config({ path: resolveEnvFiles(), quiet: true })
