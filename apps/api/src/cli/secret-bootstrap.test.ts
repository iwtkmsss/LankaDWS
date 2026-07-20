import { describe, expect, it } from 'vitest'
import { verifyPassword } from '../common/crypto.js'
import { generateEnvironmentSecrets, updateEnvironmentContents } from './secret-bootstrap.js'

describe('environment secret bootstrap', () => {
  it('generates independent high-entropy values and an Argon2id recovery hash', async () => {
    const generated = await generateEnvironmentSecrets(true)
    const { values } = generated

    expect(values.SESSION_PEPPER).toHaveLength(64)
    expect(values.CSRF_SECRET).toHaveLength(64)
    expect(values.FILE_LINK_SECRET).toHaveLength(64)
    expect(values.TOTP_ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(values.BACKUP_ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(values.BREAK_GLASS_SECRET_HASH).toMatch(/^\$argon2id\$/)
    expect(values.DEMO_SEED_PASSWORD).toBeTruthy()
    expect(new Set([values.SESSION_PEPPER, values.CSRF_SECRET, values.FILE_LINK_SECRET]).size).toBe(3)
    await expect(verifyPassword(values.BREAK_GLASS_SECRET_HASH, generated.recoverySecret)).resolves.toBe(true)
  })

  it('preserves comments and unrelated configuration while replacing managed values', () => {
    const source = '# Runtime\r\nPORT=3000\r\nSESSION_PEPPER=old\r\n'
    const updated = updateEnvironmentContents(source, { SESSION_PEPPER: 'new', CSRF_SECRET: 'csrf' })

    expect(updated).toContain('# Runtime\r\n')
    expect(updated).toContain('PORT=3000\r\n')
    expect(updated).toContain('SESSION_PEPPER=new\r\n')
    expect(updated).toContain('CSRF_SECRET=csrf\r\n')
    expect(updated).not.toContain('SESSION_PEPPER=old')
  })
})
