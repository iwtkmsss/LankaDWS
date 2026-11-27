import { id } from '../../common/crypto.js'
import { getConfig } from '../../config/config.js'
import type { PrismaService } from '../../prisma/prisma.service.js'

export type AccountType = 'ADMIN' | 'USER'

/** An administrator may let one person in without the second factor for at most a day. */
export const MAX_SECOND_FACTOR_EXEMPTION_MINUTES = 24 * 60

export interface SecurityPolicy {
  /** Kept for the policy history; the second factor is mandatory for every account type. */
  require2faAccountTypes: AccountType[]
  temporaryPasswordHours: number
  sessionHours: number
  version: number
  effectiveAt?: Date
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = { require2faAccountTypes: ['ADMIN', 'USER'], temporaryPasswordHours: 24, sessionHours: 12, version: 0 }

type SettingsDb = Pick<PrismaService, 'systemSetting'>

const CACHE_MS = 5_000
let cached: { policy: SecurityPolicy; until: number } | null = null

/**
 * The security policy in force: the newest `security-policy` setting whose `effectiveAt` has passed.
 * The session guard reads it on requests that still owe a second factor, so it is cached briefly;
 * `invalidateSecurityPolicyCache` drops the cache right after an administrator changes it.
 */
export async function readSecurityPolicy(prisma: SettingsDb, fresh = false): Promise<SecurityPolicy> {
  const now = Date.now()
  if (!fresh && cached && cached.until > now) return cached.policy
  const setting = await prisma.systemSetting.findFirst({ where: { key: 'security-policy', effectiveAt: { lte: new Date(now) } }, orderBy: { version: 'desc' } })
  const stored = setting ? JSON.parse(setting.valueJson) as Partial<SecurityPolicy> : {}
  const policy: SecurityPolicy = setting
    ? { ...DEFAULT_SECURITY_POLICY, ...stored, version: setting.version, effectiveAt: setting.effectiveAt }
    : DEFAULT_SECURITY_POLICY
  cached = { policy, until: now + CACHE_MS }
  return policy
}

export function invalidateSecurityPolicyCache(): void {
  cached = null
}

/** The second factor is enforced for everyone; there is no workspace-wide switch (only per-person exemptions). */
export function secondFactorEnforced(): boolean {
  return getConfig().SECOND_FACTOR_REQUIRED !== 'false'
}

const exemptionKey = (userId: string) => `second-factor-exemption:${userId}`

/**
 * A per-person exemption lets one user in without the second factor until `until`. It is kept as a
 * versioned `SystemSetting` row (no schema change); ending it early writes a new version with null.
 */
export async function readSecondFactorExemption(prisma: SettingsDb, userId: string): Promise<Date | null> {
  const setting = await prisma.systemSetting.findFirst({ where: { key: exemptionKey(userId) }, orderBy: { version: 'desc' } })
  const until = setting ? (JSON.parse(setting.valueJson) as { until?: string | null }).until : null
  return until && new Date(until).getTime() > Date.now() ? new Date(until) : null
}

export async function writeSecondFactorExemption(prisma: SettingsDb, userId: string, until: Date | null, actorId: string): Promise<void> {
  const latest = await prisma.systemSetting.findFirst({ where: { key: exemptionKey(userId) }, orderBy: { version: 'desc' }, select: { version: true } })
  await prisma.systemSetting.create({ data: { id: id('set'), key: exemptionKey(userId), valueJson: JSON.stringify({ until: until?.toISOString() ?? null }), version: (latest?.version ?? 0) + 1, updatedBy: actorId } })
}
