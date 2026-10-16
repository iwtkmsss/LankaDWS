import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConfigForTests } from '../../config/config.js'
import { deduplicateCleanFile, deleteStoredFile, linkCleanFile, readCleanFile, writeCleanFile } from './storage.js'

let root: string
const content = Buffer.from('shared immutable file')
const digest = createHash('sha256').update(content).digest('hex')
const metadata = (key: string) => stat(join(root, 'clean', key), { bigint: true })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lankadws-shared-storage-'))
  vi.stubEnv('FILE_STORAGE_DIR', join(root, 'clean'))
  vi.stubEnv('FILE_QUARANTINE_DIR', join(root, 'quarantine'))
  resetConfigForTests()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  resetConfigForTests()
})

describe('shared physical file storage', () => {
  it('creates separate paths pointing to the same physical bytes', async () => {
    await writeCleanFile('drive/file', content)
    await linkCleanFile('drive/file', 'chat/file')
    const source = await metadata('drive/file')
    const copy = await metadata('chat/file')
    expect([copy.dev, copy.ino]).toEqual([source.dev, source.ino])
    expect(source.nlink).toBe(2n)
    expect(await readCleanFile('chat/file')).toEqual(content)
  })

  it.each(['drive/file', 'chat/file'])('preserves the remaining reference after removing %s', async (removed) => {
    await writeCleanFile('drive/file', content)
    await linkCleanFile('drive/file', 'chat/file')
    await deleteStoredFile(removed)
    const remaining = removed === 'drive/file' ? 'chat/file' : 'drive/file'
    expect(await readCleanFile(remaining)).toEqual(content)
    expect((await metadata(remaining)).nlink).toBe(1n)
    await deleteStoredFile(remaining)
    await expect(readCleanFile(remaining)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('replaces content atomically without modifying other references', async () => {
    await writeCleanFile('drive/file', content)
    await linkCleanFile('drive/file', 'chat/file')
    await writeCleanFile('drive/file', Buffer.from('new source contents'))
    expect(await readCleanFile('chat/file')).toEqual(content)
    expect(await readCleanFile('drive/file')).toEqual(Buffer.from('new source contents'))
    expect(await readdir(join(root, 'clean', 'drive'))).toEqual(['file'])
  })

  it('combines verified existing duplicates without changing either path or content', async () => {
    await writeCleanFile('drive/file', content)
    await writeCleanFile('chat/file', content)
    const before = await metadata('chat/file')
    expect(await deduplicateCleanFile('drive/file', 'chat/file', digest, content.length)).toEqual({ duplicate: true, bytesReleased: content.length })
    expect((await metadata('chat/file')).ino).toBe(before.ino)
    expect(await deduplicateCleanFile('drive/file', 'chat/file', digest, content.length, true)).toEqual({ duplicate: true, bytesReleased: content.length })
    expect((await metadata('chat/file')).ino).toBe((await metadata('drive/file')).ino)
    expect(await readCleanFile('chat/file')).toEqual(content)
    expect(await deduplicateCleanFile('drive/file', 'chat/file', digest, content.length, true)).toEqual({ duplicate: false, bytesReleased: 0 })
  })

  it('does not replace a file when the actual content differs from its metadata', async () => {
    await writeCleanFile('drive/file', content)
    await writeCleanFile('chat/file', Buffer.alloc(content.length, 'x'))
    const before = await metadata('chat/file')
    await expect(deduplicateCleanFile('drive/file', 'chat/file', digest, content.length, true)).rejects.toThrow('FileStorageHashMismatch')
    expect((await metadata('chat/file')).ino).toBe(before.ino)
    expect(await readCleanFile('chat/file')).toEqual(Buffer.alloc(content.length, 'x'))
  })

  it('rejects paths escaping the configured storage root', async () => {
    await writeCleanFile('source', content)
    await expect(linkCleanFile('source', '../outside')).rejects.toThrow('StoragePathEscape')
    await expect(linkCleanFile('../outside', 'target')).rejects.toThrow('StoragePathEscape')
    await expect(readFile(join(root, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
