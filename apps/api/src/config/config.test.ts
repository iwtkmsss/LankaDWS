import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConfig, resetConfigForTests } from './config.js'

describe('production configuration', () => {
  afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests() })

  it('fails closed for development defaults', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSION_PEPPER', 'development-only-session-pepper-change-me')
    vi.stubEnv('CSRF_SECRET', 'development-only-csrf-secret-change-me')
    vi.stubEnv('FILE_LINK_SECRET', 'development-only-file-link-secret')
    vi.stubEnv('TOTP_ENCRYPTION_KEY', '1'.repeat(64))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', '2'.repeat(64))
    resetConfigForTests()
    expect(() => getConfig()).toThrow(/SESSION_PEPPER/)
  })

  it('accepts independent strong secrets and a real scanner', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSION_PEPPER', 'session-'.padEnd(40, 'a'))
    vi.stubEnv('CSRF_SECRET', 'csrf-'.padEnd(40, 'b'))
    vi.stubEnv('FILE_LINK_SECRET', 'file-link-'.padEnd(40, 'c'))
    vi.stubEnv('TOTP_ENCRYPTION_KEY', 'a'.repeat(64))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', 'b'.repeat(64))
    vi.stubEnv('DATABASE_URL', 'file:./data/production.db')
    vi.stubEnv('FRONTEND_ORIGIN', 'https://crm.example.test')
    vi.stubEnv('FRONTEND_BASE_URL', 'https://crm.example.test')
    vi.stubEnv('FILE_STORAGE_DIR', 'D:/lankadws-data/files')
    vi.stubEnv('FILE_QUARANTINE_DIR', 'D:/lankadws-data/quarantine')
    vi.stubEnv('FILE_TEMP_DIR', 'D:/lankadws-data/tmp')
    vi.stubEnv('BACKUP_DIR', 'E:/lankadws-backups')
    vi.stubEnv('MALWARE_SCANNER', 'unavailable')
    resetConfigForTests()
    expect(getConfig().NODE_ENV).toBe('production')
  })

  it('parses trusted import signing keys and rejects malformed configuration', () => {
    vi.stubEnv('IMPORT_SIGNING_PUBLIC_KEYS_JSON', JSON.stringify({ 'migration-key-1': 'public-key-material'.padEnd(64, '-') }))
    resetConfigForTests()
    expect(getConfig().trustedImportSigningKeys).toHaveProperty('migration-key-1')
    vi.stubEnv('IMPORT_SIGNING_PUBLIC_KEYS_JSON', '[]')
    resetConfigForTests()
    expect(() => getConfig()).toThrow(/IMPORT_SIGNING_PUBLIC_KEYS_JSON/)
  })
})
