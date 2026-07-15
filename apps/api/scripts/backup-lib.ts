import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { getConfig } from '../src/config/config.js'

export interface ManifestFile { source: string; encrypted: string; sha256: string; bytes: number }
export interface BackupManifest { version: 1; createdAt: string; database: ManifestFile; files: ManifestFile[]; correlationId: string }

export function databasePath(): string {
  const value = getConfig().DATABASE_URL
  if (!value.startsWith('file:')) throw new Error('Only local SQLite file backups are supported')
  return resolve(value.slice('file:'.length))
}

export function checksum(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }

export function encrypt(bytes: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(getConfig().BACKUP_ENCRYPTION_KEY, 'hex'), iv)
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
}

export function decrypt(bytes: Buffer): Buffer {
  const iv = bytes.subarray(0, 12)
  const tag = bytes.subarray(12, 28)
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(getConfig().BACKUP_ENCRYPTION_KEY, 'hex'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
}

export async function encryptTo(source: string, destination: string): Promise<ManifestFile> {
  const bytes = await readFile(source)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, encrypt(bytes), { flag: 'wx' })
  return { source, encrypted: destination, sha256: checksum(bytes), bytes: bytes.length }
}

export async function walk(root: string): Promise<string[]> {
  try { await stat(root) } catch { return [] }
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await walk(full))
    else if (entry.isFile()) result.push(full)
  }
  return result
}

export function encryptedFilePath(backupRoot: string, fileRoot: string, source: string): string {
  return join(backupRoot, 'files', `${relative(resolve(fileRoot), resolve(source))}.enc`)
}
