import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { getConfig } from '../../config/config.js'

function safePath(root: string, key: string): string {
  const base = resolve(root)
  const target = resolve(join(base, normalize(key)))
  if (target !== base && !target.startsWith(`${base}\\`) && !target.startsWith(`${base}/`)) throw new Error('StoragePathEscape')
  return target
}

export async function writeQuarantine(key: string, bytes: Buffer): Promise<void> {
  const target = safePath(getConfig().FILE_QUARANTINE_DIR, key)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes, { flag: 'wx' })
}

export async function promoteFile(key: string): Promise<void> {
  const source = safePath(getConfig().FILE_QUARANTINE_DIR, key)
  const target = safePath(getConfig().FILE_STORAGE_DIR, key)
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
}

export async function readCleanFile(key: string): Promise<Buffer> {
  return readFile(safePath(getConfig().FILE_STORAGE_DIR, key))
}

export function createCleanFileReadStream(key: string) {
  return createReadStream(safePath(getConfig().FILE_STORAGE_DIR, key))
}

export async function writeCleanFile(key: string, bytes: Buffer): Promise<void> {
  const target = safePath(getConfig().FILE_STORAGE_DIR, key)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    // Replace the path, never overwrite bytes shared with another hard link.
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Independent paths share immutable bytes; removing one path preserves every other reference. */
export async function linkCleanFile(sourceKey: string, targetKey: string): Promise<void> {
  const root = getConfig().FILE_STORAGE_DIR
  const target = safePath(root, targetKey)
  await mkdir(dirname(target), { recursive: true })
  await link(safePath(root, sourceKey), target)
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array)
  return hash.digest('hex')
}

/** Maintenance-only: validate both contents before atomically replacing a duplicate path. */
export async function deduplicateCleanFile(sourceKey: string, targetKey: string, sha256: string, bytes: number, apply = false) {
  const root = getConfig().FILE_STORAGE_DIR
  const source = safePath(root, sourceKey)
  const target = safePath(root, targetKey)
  const [original, duplicate] = await Promise.all([stat(source, { bigint: true }), stat(target, { bigint: true })])
  if (!original.isFile() || !duplicate.isFile()) throw new Error('FileStorageNotRegularFile')
  if (original.dev === duplicate.dev && original.ino === duplicate.ino) return { duplicate: false, bytesReleased: 0 }
  if (original.size !== BigInt(bytes) || duplicate.size !== BigInt(bytes)) throw new Error('FileStorageSizeMismatch')
  const hashes = await Promise.all([fileDigest(source), fileDigest(target)])
  if (hashes.some((hash) => hash !== sha256)) throw new Error('FileStorageHashMismatch')
  if (apply) {
    const temporary = `${target}.${randomUUID()}.link`
    try {
      await link(source, temporary)
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  return { duplicate: true, bytesReleased: duplicate.nlink === 1n ? bytes : 0 }
}

export async function deleteStoredFile(key: string): Promise<void> {
  await Promise.all([
    rm(safePath(getConfig().FILE_QUARANTINE_DIR, key), { force: true }),
    rm(safePath(getConfig().FILE_STORAGE_DIR, key), { force: true }),
  ])
}

export async function storageReady(): Promise<boolean> {
  for (const root of [getConfig().FILE_STORAGE_DIR, getConfig().FILE_QUARANTINE_DIR, getConfig().FILE_TEMP_DIR]) {
    await mkdir(root, { recursive: true })
    await stat(root)
  }
  return true
}
