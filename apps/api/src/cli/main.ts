import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { stdout } from 'node:process'
import { pathToFileURL } from 'node:url'
import { allPermissionCodes } from '@bert-crm/contracts'
import { AppModule } from '../app.module.js'
import { hashPassword, id, randomTemporaryPassword, verifyPassword } from '../common/crypto.js'
import { getConfig } from '../config/config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { assertPasswordPolicy } from '../modules/auth/password-policy.js'
import { promptHidden, promptText } from './prompts.js'

export async function createAdmin(prisma: PrismaService): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { status: 'ACTIVE', roles: { some: { status: 'ACTIVE', role: { isFullAdmin: true, status: 'ACTIVE' } } } } })
  if (existing) throw new Error('An active full administrator already exists; admin:create is intentionally one-time')
  const workspaceName = await promptText('Назва workspace', 'BERT Workspace')
  const companyName = await promptText('Display name першої компанії')
  const legalName = await promptText('Юридична назва компанії', companyName)
  const companyCode = (await promptText('Код компанії')).toLowerCase()
  const timezone = await promptText('Timezone', 'Europe/Kyiv')
  const displayName = await promptText('Ім’я адміністратора')
  const username = (await promptText('Нікнейм адміністратора')).toLowerCase()
  const password = await promptHidden('Пароль')
  const confirmation = await promptHidden('Повторіть пароль')
  if (password !== confirmation) throw new Error('Passwords do not match')
  assertPasswordPolicy(password, username, true)
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Invalid canonical username')
  if (!/^[a-z0-9-]{2,24}$/.test(companyCode)) throw new Error('Invalid company code')
  const passwordHash = await hashPassword(password)
  const workspaceId = id('ws')
  const companyId = id('cmp')
  const roleId = id('role')
  const userId = id('usr')
  await prisma.$transaction(async (tx) => {
    await tx.workspace.create({ data: { id: workspaceId, displayName: workspaceName, defaultTimezone: timezone } })
    await tx.company.create({ data: { id: companyId, workspaceId, displayName: companyName, legalName, code: companyCode, timezone } })
    for (const code of allPermissionCodes) await tx.permission.upsert({ where: { code }, create: { code, domain: code.split('.')[0] ?? 'system', risk: code.includes('reset') || code.includes('security') ? 'HIGH' : 'NORMAL', description: code }, update: {} })
    await tx.role.create({ data: { id: roleId, workspaceId, name: 'Адміністратор', normalizedName: 'адміністратор', isSystem: true, isFullAdmin: true } })
    await tx.rolePermission.createMany({ data: allPermissionCodes.map((code) => ({ id: id('rp'), roleId, permissionCode: code, scope: 'ALL_COMPANIES' })) })
    await tx.user.create({ data: { id: userId, workspaceId, primaryCompanyId: companyId, displayName, username, normalizedUsername: username, displayRole: 'Адміністратор', status: 'ACTIVE', mustChangePassword: false, mustEnroll2FA: true, timezone } })
    await tx.usernameReservation.create({ data: { id: id('unr'), workspaceId, normalizedUsername: username, currentUserId: userId, state: 'ACTIVE' } })
    await tx.userCompanyAccess.create({ data: { id: id('uca'), userId, companyId, grantedBy: userId } })
    await tx.userRole.create({ data: { id: id('ur'), userId, roleId, grantedBy: userId } })
    await tx.passwordCredential.create({ data: { id: id('pwd'), userId, passwordHash } })
    await tx.auditEvent.create({ data: { id: id('aud'), workspaceId, companyId, actorType: 'SYSTEM', actorId: userId, action: 'system.bootstrap_admin_created', entityType: 'USER', entityId: userId, result: 'SUCCESS', risk: 'CRITICAL', correlationId: id('corr') } })
  })
  stdout.write(`Створено першого адміністратора @${username}. Company ID: ${companyId}. Наступний крок: увійдіть і налаштуйте 2FA.\n`)
}

export async function recoverAdmin(prisma: PrismaService): Promise<void> {
  if (!getConfig().BREAK_GLASS_SECRET_HASH) throw new Error('BREAK_GLASS_SECRET_HASH is not configured')
  const username = (await promptText('Нікнейм адміністратора')).toLowerCase()
  const installationSecret = await promptHidden('Installation recovery secret')
  if (!(await verifyPassword(getConfig().BREAK_GLASS_SECRET_HASH, installationSecret))) throw new Error('Recovery authorization failed')
  const reason = await promptText('Причина break-glass')
  const confirmation = await promptText('Введіть RECOVER, щоб підтвердити вплив')
  if (confirmation !== 'RECOVER' || !reason.trim()) throw new Error('Recovery cancelled')
  const user = await prisma.user.findFirst({ where: { normalizedUsername: username, roles: { some: { status: 'ACTIVE', role: { isFullAdmin: true } } } } })
  if (!user) throw new Error('Eligible full administrator not found')
  const anotherAdmin = await prisma.user.findFirst({ where: { id: { not: user.id }, status: 'ACTIVE', roles: { some: { status: 'ACTIVE', role: { isFullAdmin: true } } } } })
  if (anotherAdmin) throw new Error('Another active full administrator exists; use two-person UI reset')
  const temporaryPassword = randomTemporaryPassword()
  const secretHash = await hashPassword(temporaryPassword)
  const expiresAt = new Date(Date.now() + getConfig().TEMPORARY_PASSWORD_HOURS * 3_600_000)
  await prisma.$transaction(async (tx) => {
    await tx.temporaryCredential.updateMany({ where: { userId: user.id, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } })
    await tx.temporaryCredential.create({ data: { id: id('tmp'), userId: user.id, secretHash, purpose: 'BREAK_GLASS', expiresAt } })
    await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'break_glass' } })
    await tx.user.update({ where: { id: user.id }, data: { status: 'PENDING_FIRST_LOGIN', mustChangePassword: true, mustEnroll2FA: true, authorizationVersion: { increment: 1 } } })
    await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: user.workspaceId, companyId: user.primaryCompanyId, actorType: 'SYSTEM', actorId: user.id, action: 'system.break_glass', entityType: 'USER', entityId: user.id, result: 'SUCCESS', risk: 'CRITICAL', reasonCode: reason.trim(), correlationId: id('corr') } })
  })
  stdout.write(`Одноразовий тимчасовий пароль для @${username}: ${temporaryPassword}\nДіє до: ${expiresAt.toISOString()}\nПісля закриття термінала повторний перегляд неможливий.\n`)
}

async function main(): Promise<void> {
  process.env.DISABLE_JOB_WORKER = 'true'
  const command = process.argv[2]
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const prisma = app.get(PrismaService)
    if (command === 'admin:create') await createAdmin(prisma)
    else if (command === 'admin:recover') await recoverAdmin(prisma)
    else throw new Error('Usage: npm run bert -- admin:create | admin:recover')
  } finally {
    await app.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'CLI failed'); process.exitCode = 1 })
}
