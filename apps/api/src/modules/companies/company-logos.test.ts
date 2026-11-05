import { beforeEach, expect, it, vi } from 'vitest'
import { companyInputSchema } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { CompaniesService } from './companies.service.js'
import { FilesService } from '../files/files.service.js'
import { readCleanFile } from '../files/storage.js'

vi.mock('../files/storage.js', () => ({ readCleanFile: vi.fn(), writeQuarantine: vi.fn() }))
const principal = { workspaceId: 'ws_one', userId: 'usr_admin', accountType: 'USER' } as AuthPrincipal
const company = { id: 'cmp_one', displayName: 'Компанія', code: 'company', logoFileId: 'file_existing', description: null, timezone: 'Europe/Kyiv', isActive: true, version: 1, createdAt: new Date(), updatedAt: new Date() }

beforeEach(() => vi.clearAllMocks())

function setup() {
  const prisma = {
    company: { findFirst: vi.fn().mockResolvedValue(company), update: vi.fn().mockResolvedValue(company) },
    fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'file_new', scanStatus: 'CLEAN', detectedMime: 'image/png', storageKey: 'logo' }) },
  }
  return { prisma, companies: new CompaniesService(prisma as never), files: new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never) }
}

it('checks ownership, workspace, image type and scanning before assigning a new logo', async () => {
  const { prisma, companies } = setup()
  prisma.company.findFirst.mockResolvedValueOnce(company).mockResolvedValueOnce(null)
  await companies.update(principal, company.id, companyInputSchema.parse({ name: 'Компанія', slug: 'company', logoFileId: 'file_new' }))
  expect(prisma.fileObject.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
    id: 'file_new', workspaceId: 'ws_one', companyId: null, ownerId: 'usr_admin', scanStatus: 'CLEAN',
    detectedMime: { in: ['image/png', 'image/jpeg', 'image/webp'] }, bytes: { lte: 2 * 1024 * 1024 },
  } }))
  expect(prisma.company.update.mock.calls[0]?.[0]).toMatchObject({ data: { logoFileId: 'file_new' } })
})

it('rejects inaccessible or unscanned logos before changing a company', async () => {
  const { prisma, companies } = setup()
  prisma.fileObject.findFirst.mockResolvedValueOnce(null)
  await expect(companies.update(principal, company.id, companyInputSchema.parse({ name: 'Компанія', slug: 'company', logoFileId: 'file_new' }))).rejects.toMatchObject({ status: 400 })
  expect(prisma.company.update).not.toHaveBeenCalled()
})

it.each([undefined, null, 'file_existing'])('allows preserving or removing an existing logo (%s)', async (logoFileId) => {
  const { prisma, companies } = setup()
  prisma.company.findFirst.mockResolvedValueOnce(company).mockResolvedValueOnce(null)
  await companies.update(principal, company.id, companyInputSchema.parse({ name: 'Компанія', slug: 'company', logoFileId }))
  expect(prisma.fileObject.findFirst).not.toHaveBeenCalled()
  expect(prisma.company.update.mock.calls[0]?.[0]).toMatchObject({ data: { logoFileId } })
})

it('allows reading only the current logo of a visible company in the same workspace', async () => {
  const { prisma, files } = setup()
  vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('png'))
  await expect(files.downloadCompanyLogo(principal, company.id, 'file_existing')).resolves.toEqual({ bytes: Buffer.from('png'), mime: 'image/png' })
  expect(prisma.company.findFirst).toHaveBeenCalledWith({ where: { id: 'cmp_one', workspaceId: 'ws_one', logoFileId: 'file_existing', isActive: true }, select: { id: true } })
  prisma.company.findFirst.mockResolvedValueOnce(null)
  await expect(files.downloadCompanyLogo(principal, company.id, 'file_replaced')).rejects.toMatchObject({ status: 404 })
})

it('does not read quarantined image bytes and rejects non-raster logo uploads', async () => {
  const { prisma, files } = setup()
  prisma.fileObject.findFirst.mockResolvedValueOnce({ id: 'file_new', scanStatus: 'QUARANTINED', detectedMime: 'image/png', storageKey: 'logo' })
  await expect(files.downloadCompanyLogo(principal, company.id, 'file_new')).rejects.toMatchObject({ status: 403 })
  expect(readCleanFile).not.toHaveBeenCalled()
  const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
  await expect(files.uploadCompanyLogo(principal, { buffer, size: buffer.length, mimetype: 'image/png', originalname: 'fake.png' })).rejects.toMatchObject({ status: 400 })
  await expect(files.uploadCompanyLogo(principal, { buffer, size: 2 * 1024 * 1024 + 1, mimetype: 'image/png', originalname: 'large.png' })).rejects.toMatchObject({ status: 400 })
})
