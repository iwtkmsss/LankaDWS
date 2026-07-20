import { chmod, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parse } from 'dotenv'
import { hashPassword, randomToken } from '../common/crypto.js'
import { resolveEnvFiles } from '../config/load-env.js'
import { promptText } from './prompts.js'

const managedSecretNames = [
  'SESSION_PEPPER',
  'CSRF_SECRET',
  'TOTP_ENCRYPTION_KEY',
  'FILE_LINK_SECRET',
  'BACKUP_ENCRYPTION_KEY',
  'BREAK_GLASS_SECRET_HASH',
] as const

export interface GeneratedEnvironmentSecrets {
  values: Record<string, string>
  recoverySecret: string
}

export async function generateEnvironmentSecrets(includeDevelopmentPassword = process.env.NODE_ENV !== 'production'): Promise<GeneratedEnvironmentSecrets> {
  const recoverySecret = `${randomToken(32)}-A7!`
  const values: Record<string, string> = {
    SESSION_PEPPER: randomToken(48),
    CSRF_SECRET: randomToken(48),
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    FILE_LINK_SECRET: randomToken(48),
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    BREAK_GLASS_SECRET_HASH: await hashPassword(recoverySecret),
  }
  if (includeDevelopmentPassword) values.DEMO_SEED_PASSWORD = `${randomToken(24)}-A7!`
  return { values, recoverySecret }
}

export function updateEnvironmentContents(source: string, values: Record<string, string>): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  let result = source
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`
    const matcher = new RegExp(`^${name}=.*$`, 'm')
    result = matcher.test(result) ? result.replace(matcher, () => line) : `${result.replace(/\s*$/, '')}${newline}${line}${newline}`
  }
  return result.endsWith(newline) ? result : `${result}${newline}`
}

function containsOperationalSecrets(values: Record<string, string | undefined>): boolean {
  const opaque = ['SESSION_PEPPER', 'CSRF_SECRET', 'FILE_LINK_SECRET']
  if (opaque.some((name) => {
    const value = values[name] ?? ''
    return value.length >= 32 && !/replace-with|development-only/i.test(value)
  })) return true
  for (const name of ['TOTP_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY']) {
    const value = values[name] ?? ''
    if (/^[a-fA-F0-9]{64}$/.test(value) && new Set(value.toLowerCase()).size > 4) return true
  }
  return (values.BREAK_GLASS_SECRET_HASH ?? '').startsWith('$argon2id$')
}

async function sourceEnvironment(envPath: string): Promise<string> {
  try {
    return await readFile(envPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const repository = process.env.INIT_CWD ?? resolve(process.cwd(), '..', '..')
    return readFile(resolve(repository, '.env.example'), 'utf8')
  }
}

export async function bootstrapEnvironmentSecrets(): Promise<void> {
  const envPath = resolveEnvFiles()[0]
  if (!envPath) throw new Error('Unable to resolve the target .env path')
  const source = await sourceEnvironment(envPath)
  const existing = parse(source)
  const rotating = containsOperationalSecrets(existing)
  const confirmation = rotating ? 'ROTATE' : 'GENERATE'

  process.stdout.write(`Target: ${envPath}\n`)
  if (rotating) {
    process.stdout.write('УВАГА: чинні секрети буде замінено. Активні сесії стануть недійсними; старі TOTP/private-data ciphertext і backup можуть вимагати попередніх ключів. Спочатку створіть backup та збережіть старі ключі у захищеному сховищі.\n')
  }
  const answer = await promptText(`Введіть ${confirmation}, щоб ${rotating ? 'ротувати' : 'згенерувати'} всі секрети`)
  if (answer !== confirmation) throw new Error('Secret generation cancelled')

  const generated = await generateEnvironmentSecrets()
  await writeFile(envPath, updateEnvironmentContents(source, generated.values), { encoding: 'utf8', mode: 0o600 })
  try { await chmod(envPath, 0o600) } catch { /* Windows ACLs are managed separately. */ }

  const changed = [...managedSecretNames, ...(generated.values.DEMO_SEED_PASSWORD ? ['DEMO_SEED_PASSWORD'] : [])]
  process.stdout.write(`Оновлено ${changed.length} значень у ${envPath}: ${changed.join(', ')}.\n`)
  process.stdout.write(`ОДНОРАЗОВИЙ INSTALLATION RECOVERY SECRET: ${generated.recoverySecret}\n`)
  process.stdout.write('Збережіть recovery secret у password manager зараз: він не записаний у .env і повторно не відображатиметься. Перезапустіть API після зміни конфігурації.\n')
}
