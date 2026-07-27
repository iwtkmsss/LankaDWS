import { z } from 'zod'
import './load-env.js'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  FRONTEND_BASE_URL: z.string().url().default('http://localhost:5173'),
  TRUSTED_PROXY: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  FILE_STORAGE_DIR: z.string().default('../../data/files'),
  FILE_QUARANTINE_DIR: z.string().default('../../data/quarantine'),
  FILE_TEMP_DIR: z.string().default('../../data/tmp'),
  BACKUP_DIR: z.string().default('../../backups'),
  BITRIX_SNAPSHOT_ROOT: z.string().optional(),
  BITRIX_MANIFEST_METADATA_PATH: z.string().optional(),
  IMPORT_SIGNING_PUBLIC_KEYS_JSON: z.string().default('{}'),
  IMPORT_SIGNING_PRIVATE_KEY_PATH: z.string().optional(),
  BACKUP_KEEP_DAILY: z.coerce.number().int().min(1).max(365).default(30),
  BACKUP_KEEP_MONTHLY: z.coerce.number().int().min(1).max(120).default(12),
  BACKUP_SCHEDULE_CRON: z.string().default('0 * * * *'),
  RETENTION_SCHEDULE_CRON: z.string().default('15 2 * * *'),
  SESSION_PEPPER: z.string().default('development-only-session-pepper-change-me'),
  CSRF_SECRET: z.string().default('development-only-csrf-secret-change-me'),
  TOTP_ENCRYPTION_KEY: z.string().default('1'.repeat(64)),
  FILE_LINK_SECRET: z.string().default('development-only-file-link-secret'),
  BACKUP_ENCRYPTION_KEY: z.string().default('2'.repeat(64)),
  BREAK_GLASS_SECRET_HASH: z.string().default(''),
  SESSION_COOKIE_NAME: z.string().default('bert_session'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  TEMPORARY_PASSWORD_HOURS: z.coerce.number().int().positive().default(24),
  REAUTH_MINUTES: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(8),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  ALLOWED_UPLOAD_MIME: z.string().default('application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,text/plain'),
  MALWARE_SCANNER: z.enum(['development-clean', 'clamav', 'unavailable']).default('development-clean'),
  JOB_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  JOB_POLL_MS: z.coerce.number().int().min(250).default(1000),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(10).default(60),
  LOG_LEVEL: z.string().default('info'),
  LOG_FORMAT: z.enum(['json']).default('json'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
})

export type AppConfig = z.infer<typeof schema> & {
  allowedMime: Set<string>
  trustedImportSigningKeys: Record<string, string>
}

let cached: AppConfig | undefined

export function getConfig(): AppConfig {
  if (cached) return cached
  const parsed = schema.parse(process.env)
  let trustedImportSigningKeys: Record<string, string>
  try {
    trustedImportSigningKeys = z.record(
      z.string().trim().min(1).max(160),
      z.string().min(32).max(16_000),
    ).parse(JSON.parse(parsed.IMPORT_SIGNING_PUBLIC_KEYS_JSON) as unknown)
  } catch {
    throw new Error('IMPORT_SIGNING_PUBLIC_KEYS_JSON must be a JSON object of key IDs to public keys')
  }
  if (parsed.NODE_ENV === 'production') {
    const secrets: Array<[string, string]> = [
      ['SESSION_PEPPER', parsed.SESSION_PEPPER],
      ['CSRF_SECRET', parsed.CSRF_SECRET],
      ['FILE_LINK_SECRET', parsed.FILE_LINK_SECRET],
    ]
    for (const [name, value] of secrets) {
      if (value.length < 32 || value.includes('development-only') || value.includes('replace-with')) {
        throw new Error(`${name} must be an independent random value of at least 32 characters`)
      }
    }
    if (!/^[a-fA-F0-9]{64}$/.test(parsed.TOTP_ENCRYPTION_KEY)) {
      throw new Error('TOTP_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters')
    }
    if (!/^[a-fA-F0-9]{64}$/.test(parsed.BACKUP_ENCRYPTION_KEY)) {
      throw new Error('BACKUP_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters')
    }
    if (!parsed.DATABASE_URL.startsWith('file:') || parsed.DATABASE_URL.includes(':memory:')) {
      throw new Error('DATABASE_URL must point to a persistent local SQLite file')
    }
    if (parsed.DATABASE_URL === 'file:./prisma/dev.db') throw new Error('DATABASE_URL must not use the development database path in production')
    if (parsed.FRONTEND_ORIGIN.includes('localhost') || parsed.FRONTEND_BASE_URL.includes('localhost')) throw new Error('FRONTEND_ORIGIN and FRONTEND_BASE_URL must use production origins')
    const developmentPaths = new Set(['../../data/files', '../../data/quarantine', '../../data/tmp', '../../backups'])
    for (const [name, value] of [['FILE_STORAGE_DIR', parsed.FILE_STORAGE_DIR], ['FILE_QUARANTINE_DIR', parsed.FILE_QUARANTINE_DIR], ['FILE_TEMP_DIR', parsed.FILE_TEMP_DIR], ['BACKUP_DIR', parsed.BACKUP_DIR]]) {
      if (developmentPaths.has(value)) throw new Error(`${name} must point to an explicit production volume path`)
    }
    if (parsed.MALWARE_SCANNER === 'development-clean') {
      throw new Error('MALWARE_SCANNER development-clean is forbidden in production')
    }
  }
  cached = {
    ...parsed,
    allowedMime: new Set(parsed.ALLOWED_UPLOAD_MIME.split(',').map((value) => value.trim())),
    trustedImportSigningKeys,
  }
  return cached
}

export function resetConfigForTests(): void {
  cached = undefined
}
