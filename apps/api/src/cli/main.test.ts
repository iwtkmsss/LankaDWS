import { afterEach, describe, expect, it } from 'vitest'
import { resetConfigForTests } from '../config/config.js'
import { createAdmin, recoverAdmin } from './main.js'
import type { PrismaService } from '../prisma/prisma.service.js'

afterEach(() => {
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
})
