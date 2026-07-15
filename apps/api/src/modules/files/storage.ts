import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
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

export async function writeCleanFile(key: string, bytes: Buffer): Promise<void> {
  const target = safePath(getConfig().FILE_STORAGE_DIR, key)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
}

export async function storageReady(): Promise<boolean> {
  for (const root of [getConfig().FILE_STORAGE_DIR, getConfig().FILE_QUARANTINE_DIR, getConfig().FILE_TEMP_DIR]) {
    await mkdir(root, { recursive: true })
    await stat(root)
  }
  return true
}
