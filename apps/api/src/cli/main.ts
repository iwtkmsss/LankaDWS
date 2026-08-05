import '../config/load-env.js'
import { NestFactory } from '@nestjs/core'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { stdout } from 'node:process'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppModule } from '../app.module.js'
import { hashPassword, id, randomTemporaryPassword, verifyPassword } from '../common/crypto.js'
import { normalizeUserSearchValue } from '../common/user-search.js'
import { getConfig } from '../config/config.js'
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { assertPasswordPolicy } from '../modules/auth/password-policy.js'
import { validateCompanyMappingAgainstDatabase } from '../modules/import-control/company-mapping-db-validator.js'
import {
  ImportManifestSealError,
  loadBitrixSnapshotSealRequest,
  loadEd25519PrivateKey,
  sealImportManifest,
} from '../modules/import-control/manifest-sealer.js'
import { validateImportManifest } from '../modules/import-control/manifest-validator.js'
import { promptHidden, promptText } from './prompts.js'
import { bootstrapEnvironmentSecrets } from './secret-bootstrap.js'

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === ''
    || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let amount = value
  let unit = 'B'
  for (const next of units) {
    amount /= 1024
    unit = next
    if (amount < 1024) break
  }
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${unit}`
}

function resolveImportDatasetRoot(configuredRoot: string | undefined): string {
  if (!configuredRoot || !isAbsolute(configuredRoot)) {
    throw new Error('BITRIX_SNAPSHOT_ROOT must be an explicit absolute dataset root')
  }
  const datasetRoot = resolve(configuredRoot)
  const forbiddenRoots = new Set([
    resolve(process.cwd()),
    resolve(process.cwd(), '..', '..'),
    ...(process.env.INIT_CWD ? [resolve(process.env.INIT_CWD)] : []),
  ])
  if ([...forbiddenRoots].some((root) => isWithin(root, datasetRoot))) {
    throw new Error('BITRIX_SNAPSHOT_ROOT must be outside the BertCRM repository')
  }
  return datasetRoot
}

function resolveImportSupportFile(
  configuredPath: string | undefined,
  variableName: string,
  datasetRoot: string,
): string {
  if (!configuredPath || !isAbsolute(configuredPath)) {
    throw new Error(`${variableName} must be an explicit absolute file path`)
  }
  const candidate = resolve(configuredPath)
  const forbiddenRoots = new Set([
    resolve(process.cwd()),
    resolve(process.cwd(), '..', '..'),
    ...(process.env.INIT_CWD ? [resolve(process.env.INIT_CWD)] : []),
    datasetRoot,
  ])
  if ([...forbiddenRoots].some((root) => isWithin(root, candidate))) {
    throw new Error(`${variableName} must be outside the BertCRM repository and dataset root`)
  }
  return candidate
}

export async function sealImportManifestCommand(json = false): Promise<boolean> {
  const config = getConfig()
  const datasetRoot = resolveImportDatasetRoot(config.BITRIX_SNAPSHOT_ROOT)
  const metadataPath = resolveImportSupportFile(
    config.BITRIX_MANIFEST_METADATA_PATH,
    'BITRIX_MANIFEST_METADATA_PATH',
    datasetRoot,
  )
  const privateKeyPath = resolveImportSupportFile(
    config.IMPORT_SIGNING_PRIVATE_KEY_PATH,
    'IMPORT_SIGNING_PRIVATE_KEY_PATH',
    datasetRoot,
  )
  if (metadataPath.toLowerCase() === privateKeyPath.toLowerCase()) {
    throw new Error('Manifest metadata and the private signing key must be separate files')
  }

  let lastProgress = 0
  try {
    const [request, privateKey] = await Promise.all([
      loadBitrixSnapshotSealRequest(metadataPath),
      loadEd25519PrivateKey(privateKeyPath),
    ])
    const report = await sealImportManifest({
      datasetRoot,
      request,
      privateKey,
      onProgress: stdout.isTTY && !json
        ? ({ completedFiles, totalFiles }) => {
            const progress = totalFiles === 0 ? 100 : Math.floor((completedFiles / totalFiles) * 100)
            if (progress >= lastProgress + 5 || completedFiles === totalFiles) {
              lastProgress = progress
              stdout.write(`\rХешування export: ${completedFiles}/${totalFiles} (${progress}%)`)
            }
          }
        : undefined,
    })
    if (stdout.isTTY && !json && report.counters.files > 0) stdout.write('\n')
    if (json) {
      stdout.write(`${JSON.stringify({
        sealed: report.sealed,
        changed: report.changed,
        manifestSha256: report.manifestSha256,
        dataset: report.dataset,
        counters: report.counters,
        issues: [],
      }, null, 2)}\n`)
      return true
    }
    stdout.write(`${report.changed ? '✓ Manifest створено й перевірено' : '✓ Manifest уже відповідає dataset'}\n`)
    stdout.write(`Dataset: ${report.dataset.datasetId} · ${report.dataset.kind} #${report.dataset.sequence}\n`)
    stdout.write(`Файли: ${report.counters.files} · ${formatBytes(report.counters.bytes)}\n`)
    stdout.write(`Manifest SHA-256: ${report.manifestSha256}\n`)
    return true
  } catch (error) {
    if (!(error instanceof ImportManifestSealError)) throw error
    const failure = {
      sealed: false,
      changed: false,
      manifestSha256: null,
      dataset: null,
      counters: { files: 0, bytes: 0 },
      issues: [{
        code: error.code,
        severity: 'BLOCKING',
        path: error.path,
        detail: error.message,
      }],
    }
    if (stdout.isTTY && !json && lastProgress > 0) stdout.write('\n')
    if (json) stdout.write(`${JSON.stringify(failure, null, 2)}\n`)
    else stdout.write(`✗ Manifest не створено\n[BLOCKING] ${error.code}${error.path ? ` · ${error.path}` : ''}: ${error.message}\n`)
    return false
  }
}

export async function validateImportManifestCommand(json = false): Promise<boolean> {
  const config = getConfig()
  const datasetRoot = resolveImportDatasetRoot(config.BITRIX_SNAPSHOT_ROOT)

  let lastProgress = 0
  const report = await validateImportManifest({
    datasetRoot,
    trustedSigningKeys: config.trustedImportSigningKeys,
    onProgress: stdout.isTTY && !json
      ? ({ completedFiles, declaredFiles }) => {
          const progress = Math.floor((completedFiles / declaredFiles) * 100)
          if (progress >= lastProgress + 5 || completedFiles === declaredFiles) {
            lastProgress = progress
            stdout.write(`\rПеревірка файлів: ${completedFiles}/${declaredFiles} (${progress}%)`)
          }
        }
      : undefined,
  })

  if (stdout.isTTY && !json && report.counters.declaredFiles > 0) stdout.write('\n')
  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.valid
  }

  stdout.write(`${report.valid ? '✓' : '✗'} Manifest ${report.valid ? 'пройшов' : 'не пройшов'} перевірку\n`)
  if (report.dataset) {
    stdout.write(`Dataset: ${report.dataset.datasetId} · ${report.dataset.kind} #${report.dataset.sequence}\n`)
    stdout.write(`Source: ${report.dataset.sourceSystem}/${report.dataset.sourceTenantId} · build ${report.dataset.sourceBuild}\n`)
  }
  if (report.companyMapping) {
    stdout.write(
      `Company map v${report.companyMapping.version}: ${report.companyMapping.mappedRoots}/${report.companyMapping.sourceRoots} roots`
      + ` · ${report.companyMapping.targetCompanies} companies · approvals ${report.companyMapping.approvals}/3\n`,
    )
  }
  stdout.write(`Файли: ${report.counters.verifiedFiles}/${report.counters.declaredFiles} · ${formatBytes(report.counters.verifiedBytes)}/${formatBytes(report.counters.declaredBytes)}\n`)
  if (report.manifestSha256) stdout.write(`Manifest SHA-256: ${report.manifestSha256}\n`)
  for (const current of report.issues) {
    stdout.write(`[${current.severity}] ${current.code}${current.path ? ` · ${current.path}` : ''}: ${current.detail}\n`)
  }
  return report.valid
}

export async function validateCompanyMappingCommand(
  prisma: Pick<PrismaService, 'sourceCompanyMapping'>,
  json = false,
): Promise<boolean> {
  const config = getConfig()
  const datasetRoot = resolveImportDatasetRoot(config.BITRIX_SNAPSHOT_ROOT)
  let lastProgress = 0
  const report = await validateCompanyMappingAgainstDatabase({
    datasetRoot,
    trustedSigningKeys: config.trustedImportSigningKeys,
    onProgress: stdout.isTTY && !json
      ? ({ completedFiles, declaredFiles }) => {
          const progress = Math.floor((completedFiles / declaredFiles) * 100)
          if (progress >= lastProgress + 5 || completedFiles === declaredFiles) {
            lastProgress = progress
            stdout.write(`\rПеревірка файлів: ${completedFiles}/${declaredFiles} (${progress}%)`)
          }
        }
      : undefined,
    reader: {
      findActiveMappings: (scope) => prisma.sourceCompanyMapping.findMany({
        where: {
          workspaceId: scope.workspaceId,
          sourceSystem: scope.sourceSystem,
          sourceTenantId: scope.sourceTenantId,
          version: scope.version,
          status: 'ACTIVE',
        },
        orderBy: { sourceOrgUnitKey: 'asc' },
        take: scope.limit,
        select: {
          sourceOrgUnitKey: true,
          targetCompanyId: true,
          targetCompany: {
            select: {
              id: true,
              code: true,
              status: true,
              workspaceId: true,
            },
          },
        },
      }),
    },
  })

  if (stdout.isTTY && !json && report.manifestSha256) stdout.write('\n')
  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.valid
  }

  stdout.write(`${report.valid ? '✓' : '✗'} Company mapping DB preflight\n`)
  if (report.targetWorkspaceId && report.companyMappingVersion) {
    stdout.write(`Workspace: ${report.targetWorkspaceId} · company map v${report.companyMappingVersion}\n`)
  }
  stdout.write(
    `Rows: ${report.counters.matchedRows}/${report.counters.signedRoots} matched`
    + ` · ${report.counters.activeRows} active · ${report.counters.targetCompanies} target companies\n`,
  )
  if (report.manifestSha256) stdout.write(`Manifest SHA-256: ${report.manifestSha256}\n`)
  for (const current of report.issues) {
    stdout.write(`[${current.severity}] ${current.code}${current.path ? ` · ${current.path}` : ''}: ${current.detail}\n`)
  }
  return report.valid
}

export async function resetDevelopmentAdmin(prisma: PrismaService): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('admin:dev-reset is forbidden in production')
  const password = process.env.DEMO_SEED_PASSWORD
  if (!password) throw new Error('DEMO_SEED_PASSWORD is missing; run: npm run bert -- recovery:hash')
  const administrators = await prisma.user.findMany({
    where: { isActive: true, accountType: 'ADMIN' },
    select: { id: true, username: true, workspaceId: true, primaryCompanyId: true },
    take: 2,
  })
  if (administrators.length !== 1) throw new Error('admin:dev-reset requires exactly one non-deactivated full administrator')
  const [user] = administrators
  if (!user) throw new Error('Development administrator not found')
  const passwordHash = await hashPassword(password)
  const correlationId = id('corr')
  await prisma.$transaction(async (tx) => {
    await tx.temporaryCredential.updateMany({ where: { userId: user.id, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } })
    await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'development_admin_reset' } })
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } })
    await tx.totpCredential.deleteMany({ where: { userId: user.id } })
    await tx.passwordCredential.upsert({
      where: { userId: user.id },
      create: { id: id('pwd'), userId: user.id, passwordHash },
      update: { passwordHash, credentialVersion: { increment: 1 }, changedAt: new Date(), compromisedAt: null },
    })
    await tx.user.update({ where: { id: user.id }, data: { isActive: true, mustEnroll2FA: false, authorizationVersion: { increment: 1 } } })
    await tx.credentialEvent.create({ data: { id: id('cev'), userId: user.id, actorId: user.id, type: 'development_admin_reset', result: 'SUCCESS', reasonCode: 'local_development', correlationId } })
    await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: user.workspaceId, companyId: user.primaryCompanyId, actorType: 'SYSTEM', actorId: user.id, action: 'system.development_admin_reset', entityType: 'USER', entityId: user.id, result: 'SUCCESS', risk: 'CRITICAL', reasonCode: 'local_development', correlationId } })
  })
  stdout.write(`Development admin готовий.\nЛогін: ${user.username}\nПароль: ${password}\n`)
}

export async function createAdmin(prisma: PrismaService): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { isActive: true, accountType: 'ADMIN' } })
  if (existing) throw new Error('An active full administrator already exists; admin:create is intentionally one-time')
  const workspaceName = await promptText('Назва workspace', 'BERT Workspace')
  const timezone = await promptText('Timezone', 'Europe/Kyiv')
  const displayName = await promptText('Ім’я адміністратора')
  const username = (await promptText('Нікнейм адміністратора')).toLowerCase()
  const password = await promptHidden('Пароль')
  const confirmation = await promptHidden('Повторіть пароль')
  if (password !== confirmation) throw new Error('Passwords do not match')
  assertPasswordPolicy(password, username, true)
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Invalid canonical username')
  const passwordHash = await hashPassword(password)
  const workspaceId = id('ws')
  const userId = id('usr')
  await prisma.$transaction(async (tx) => {
    await tx.workspace.create({ data: { id: workspaceId, displayName: workspaceName, defaultTimezone: timezone } })
    await tx.user.create({ data: { id: userId, workspaceId, primaryCompanyId: null, accountType: 'ADMIN', firstName: displayName, lastName: '', displayName, normalizedDisplayName: normalizeUserSearchValue(displayName), username, normalizedUsername: username, isActive: true, mustEnroll2FA: true, timezone } })
    await tx.usernameReservation.create({ data: { id: id('unr'), workspaceId, normalizedUsername: username, currentUserId: userId, state: 'ACTIVE' } })
    await tx.passwordCredential.create({ data: { id: id('pwd'), userId, passwordHash } })
    await tx.auditEvent.create({ data: { id: id('aud'), workspaceId, companyId: null, actorType: 'SYSTEM', actorId: userId, action: 'system.bootstrap_admin_created', entityType: 'USER', entityId: userId, result: 'SUCCESS', risk: 'CRITICAL', correlationId: id('corr') } })
  })
  stdout.write(`Створено першого глобального адміністратора @${username}. Наступний крок: увійдіть, створіть компанію і налаштуйте 2FA.\n`)
}

export async function recoverAdmin(prisma: PrismaService): Promise<void> {
  const recoveryHash = getConfig().BREAK_GLASS_SECRET_HASH
  if (!recoveryHash) throw new Error('BREAK_GLASS_SECRET_HASH is not configured')
  if (!recoveryHash.startsWith('$argon2id$')) throw new Error('BREAK_GLASS_SECRET_HASH must be an Argon2id hash; run: npm run bert -- recovery:hash')
  const username = (await promptText('Нікнейм адміністратора')).toLowerCase()
  const installationSecret = await promptHidden('Installation recovery secret')
  if (!(await verifyPassword(recoveryHash, installationSecret))) throw new Error('Recovery authorization failed')
  const reason = await promptText('Причина break-glass')
  const confirmation = await promptText('Введіть RECOVER, щоб підтвердити вплив')
  if (confirmation !== 'RECOVER' || !reason.trim()) throw new Error('Recovery cancelled')
  const user = await prisma.user.findFirst({ where: { normalizedUsername: username, accountType: 'ADMIN' } })
  if (!user) throw new Error('Eligible full administrator not found')
  const anotherAdmin = await prisma.user.findFirst({ where: { id: { not: user.id }, isActive: true, accountType: 'ADMIN' } })
  if (anotherAdmin) throw new Error('Another active full administrator exists; use two-person UI reset')
  const temporaryPassword = randomTemporaryPassword()
  const secretHash = await hashPassword(temporaryPassword)
  const expiresAt = new Date(Date.now() + getConfig().TEMPORARY_PASSWORD_HOURS * 3_600_000)
  await prisma.$transaction(async (tx) => {
    await tx.temporaryCredential.updateMany({ where: { userId: user.id, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } })
    await tx.temporaryCredential.create({ data: { id: id('tmp'), userId: user.id, secretHash, purpose: 'BREAK_GLASS', expiresAt } })
    await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'break_glass' } })
    await tx.user.update({ where: { id: user.id }, data: { isActive: true, mustEnroll2FA: true, authorizationVersion: { increment: 1 } } })
    await tx.auditEvent.create({ data: { id: id('aud'), workspaceId: user.workspaceId, companyId: user.primaryCompanyId, actorType: 'SYSTEM', actorId: user.id, action: 'system.break_glass', entityType: 'USER', entityId: user.id, result: 'SUCCESS', risk: 'CRITICAL', reasonCode: reason.trim(), correlationId: id('corr') } })
  })
  stdout.write(`Одноразовий тимчасовий пароль для @${username}: ${temporaryPassword}\nДіє до: ${expiresAt.toISOString()}\nПісля закриття термінала повторний перегляд неможливий.\n`)
}

async function main(): Promise<void> {
  process.env.DISABLE_JOB_WORKER = 'true'
  const command = process.argv[2]
  if (command === 'recovery:hash') {
    await bootstrapEnvironmentSecrets()
    return
  }
  if (command === 'import:seal-manifest') {
    const sealed = await sealImportManifestCommand(process.argv.includes('--json'))
    if (!sealed) process.exitCode = 2
    return
  }
  if (command === 'import:validate-manifest') {
    const valid = await validateImportManifestCommand(process.argv.includes('--json'))
    if (!valid) process.exitCode = 2
    return
  }
  if (command === 'import:validate-company-map') {
    const config = getConfig()
    resolveImportDatasetRoot(config.BITRIX_SNAPSHOT_ROOT)
    const prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({
        url: config.DATABASE_URL,
        readonly: true,
        fileMustExist: true,
      }),
    })
    try {
      await prisma.$connect()
      const valid = await validateCompanyMappingCommand(prisma, process.argv.includes('--json'))
      if (!valid) process.exitCode = 2
    } finally {
      await prisma.$disconnect()
    }
    return
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const prisma = app.get(PrismaService)
    if (command === 'admin:create') await createAdmin(prisma)
    else if (command === 'admin:recover') await recoverAdmin(prisma)
    else if (command === 'admin:dev-reset') await resetDevelopmentAdmin(prisma)
    else {
      throw new Error(
        'Usage: npm run bert -- admin:create | admin:recover | admin:dev-reset | recovery:hash'
        + ' | import:seal-manifest [--json] | import:validate-manifest [--json]'
        + ' | import:validate-company-map [--json]',
      )
    }
  } finally {
    await app.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'CLI failed'); process.exitCode = 1 })
}
