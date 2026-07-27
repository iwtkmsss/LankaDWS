import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { resetConfigForTests } from '../config/config.js'
import {
  createAdmin,
  recoverAdmin,
  resetDevelopmentAdmin,
  sealImportManifestCommand,
  validateImportManifestCommand,
} from './main.js'
import type { PrismaService } from '../prisma/prisma.service.js'

afterEach(() => {
  vi.unstubAllEnvs()
  delete process.env.BREAK_GLASS_SECRET_HASH
  resetConfigForTests()
})

describe('administrator CLI guards', () => {
  it('refuses admin:create when an active full administrator exists before requesting credentials', async () => {
    const prisma = { user: { findFirst: () => Promise.resolve({ id: 'usr_admin' }) } } as unknown as PrismaService
    await expect(createAdmin(prisma)).rejects.toThrow(/already exists/i)
  })

  it('fails closed when break-glass installation authorization is not configured', async () => {
    process.env.BREAK_GLASS_SECRET_HASH = ''
    resetConfigForTests()
    await expect(recoverAdmin({} as PrismaService)).rejects.toThrow(/BREAK_GLASS_SECRET_HASH/)
  })

  it('rejects a plaintext recovery secret in configuration', async () => {
    process.env.BREAK_GLASS_SECRET_HASH = 'plaintext-secret'
    resetConfigForTests()
    await expect(recoverAdmin({} as PrismaService)).rejects.toThrow(/Argon2id/)
  })

  it('forbids the simplified administrator reset in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(resetDevelopmentAdmin({} as PrismaService)).rejects.toThrow(/forbidden in production/)
  })

  it('requires an explicit snapshot root outside the BertCRM repository', async () => {
    vi.stubEnv('BITRIX_SNAPSHOT_ROOT', '')
    resetConfigForTests()
    await expect(validateImportManifestCommand()).rejects.toThrow(/explicit absolute dataset root/)

    vi.stubEnv('BITRIX_SNAPSHOT_ROOT', resolve(process.cwd()))
    resetConfigForTests()
    await expect(validateImportManifestCommand()).rejects.toThrow(/outside the BertCRM repository/)
  })

  it('keeps manifest metadata and the private signing key outside both repository and dataset', async () => {
    const externalRoot = resolve(process.cwd(), '..', '..', '..', 'bert-manifest-fixture')
    vi.stubEnv('BITRIX_SNAPSHOT_ROOT', externalRoot)
    vi.stubEnv('BITRIX_MANIFEST_METADATA_PATH', resolve(process.cwd(), 'seal-request.json'))
    vi.stubEnv('IMPORT_SIGNING_PRIVATE_KEY_PATH', resolve(externalRoot, 'private.pem'))
    resetConfigForTests()

    await expect(sealImportManifestCommand()).rejects.toThrow(
      /BITRIX_MANIFEST_METADATA_PATH must be outside/,
    )
  })
})
