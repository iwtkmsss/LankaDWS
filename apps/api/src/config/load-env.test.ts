import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEnvFiles } from './load-env.js'

describe('environment file resolution', () => {
  it('loads only the repository environment when started from the repository', () => {
    const repository = resolve('C:/example/lankadws')
    const api = resolve(repository, 'apps/api')

    expect(resolveEnvFiles({ cwd: api, initCwd: repository })).toEqual([
      resolve(repository, '.env'),
    ])
  })

  it('resolves the repository root from an API workspace invocation', () => {
    const api = resolve('C:/example/lankadws/apps/api')
    expect(resolveEnvFiles({ cwd: api, initCwd: '' })).toEqual([
      resolve('C:/example/lankadws/.env'),
    ])
  })
})
