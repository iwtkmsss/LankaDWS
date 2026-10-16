import { expect, it, vi } from 'vitest'
import { createCompanySchema } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { CompaniesService } from './companies.service.js'

const principal = { workspaceId: 'ws_test', userId: 'usr_admin' } as AuthPrincipal
const input = createCompanySchema.parse({ name: 'Нова компанія', slug: 'new-company', managerId: 'usr_a', employeeIds: ['usr_b', 'usr_a'] })

function setup(foundIds = ['usr_a', 'usr_b']) {
  const company = { id: 'cmp_new', displayName: input.name, code: input.slug, description: null, timezone: input.timezone, version: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() }
  const tx = {
    company: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(company), updateMany: vi.fn(), update: vi.fn().mockResolvedValue({ ...company, manager: { id: 'usr_a', displayName: 'Андрій Коваль', jobTitle: '', isActive: true, primaryCompanyId: company.id } }) },
    user: { findMany: vi.fn().mockResolvedValue(foundIds.map((id) => ({ id, primaryCompanyId: 'cmp_old' }))), updateMany: vi.fn() },
    orgUnit: { updateMany: vi.fn() }, userOrgAssignment: { updateMany: vi.fn() }, auditEvent: { create: vi.fn() },
  }
  const prisma = { $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => await run(tx)) }
  return { tx, prisma, service: new CompaniesService(prisma as unknown as PrismaService) }
}

it('creates the company, transfers members and assigns a valid manager in one transaction', async () => {
  const { service, tx, prisma } = setup()
  const result = await service.create(principal, input)
  expect(prisma.$transaction).toHaveBeenCalledOnce()
  expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['usr_b', 'usr_a'] }, workspaceId: 'ws_test', accountType: 'USER', isActive: true } }))
  expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { primaryCompanyId: 'cmp_new', authorizationVersion: { increment: 1 } } }))
  expect(tx.userOrgAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { endedAt: expect.any(Date) as Date, isPrimary: false } }))
  expect(tx.company.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { managerId: null, version: { increment: 1 } } }))
  expect(tx.orgUnit.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { managerId: null, version: { increment: 1 } } }))
  expect(result.manager?.id).toBe('usr_a')
  expect(tx.auditEvent.create).toHaveBeenCalledOnce()
})

it('rejects unavailable or out-of-workspace employees before creating anything', async () => {
  const { service, tx } = setup(['usr_a'])
  await expect(service.create(principal, input)).rejects.toThrow()
  expect(tx.company.create).not.toHaveBeenCalled()
  expect(tx.user.updateMany).not.toHaveBeenCalled()
})

it('rejects duplicate slugs before transferring employees', async () => {
  const { service, tx } = setup()
  tx.company.findUnique.mockResolvedValue({ id: 'cmp_existing' })
  await expect(service.create(principal, input)).rejects.toThrow()
  expect(tx.company.create).not.toHaveBeenCalled()
  expect(tx.user.updateMany).not.toHaveBeenCalled()
})

it('keeps basic company creation compatible without selected people', async () => {
  const { service, tx } = setup()
  await service.create(principal, createCompanySchema.parse({ name: 'Компанія', slug: 'company' }))
  expect(tx.user.findMany).not.toHaveBeenCalled()
  expect(tx.user.updateMany).not.toHaveBeenCalled()
  expect(tx.company.update).not.toHaveBeenCalled()
})

it('validates unique employee IDs and limits bulk creation selections', () => {
  expect(createCompanySchema.safeParse({ ...input, employeeIds: ['usr_a', 'usr_a'] }).success).toBe(false)
  expect(createCompanySchema.safeParse({ ...input, employeeIds: Array.from({ length: 101 }, (_, index) => `usr_${index}`) }).success).toBe(false)
})
