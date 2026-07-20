import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEnvFiles } from './load-env.js'

describe('environment file resolution', () => {
  it('loads the initiating repository environment before the workspace fallback', () => {
    const repository = resolve('C:/example/bert-crm')
    const api = resolve(repository, 'apps/api')

    expect(resolveEnvFiles({ cwd: api, initCwd: repository, explicitPath: '' })).toEqual([
      resolve(repository, '.env'),
      resolve(api, '.env'),
    ])
  })

  it('keeps an explicitly selected environment file first', () => {
    const api = resolve('C:/example/bert-crm/apps/api')
    expect(resolveEnvFiles({ cwd: api, initCwd: '', explicitPath: './custom.env' })[0]).toBe(resolve(api, 'custom.env'))
  })
})
