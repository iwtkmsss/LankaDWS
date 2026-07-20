import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetConfigForTests } from '../config/config.js'
import { createAdmin, recoverAdmin, resetDevelopmentAdmin } from './main.js'
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
})
