import {
  bitrixSnapshotManifestPayloadSchema,
  bitrixSnapshotManifestSchema,
  bitrixSnapshotSealRequestSchema,
  importDatasetRelativePathSchema,
  type BitrixSnapshotManifest,
  type BitrixSnapshotSealRequest,
  type ImportManifestFile,
  type ImportManifestValidationReport,
} from '@lankadws/contracts'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  type KeyObject,
} from 'node:crypto'
import { open, lstat, mkdtemp, readdir, realpath, rm, stat, unlink, writeFile, link } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { assertNoDuplicateJsonKeys, importManifestSigningBytes, validateImportManifest } from './manifest-validator.js'

const MANIFEST_FILENAME = 'snapshot-manifest.json'
const CHECKSUMS_FILENAME = 'checksums.sha256'
const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const MAX_PRIVATE_KEY_BYTES = 16 * 1024
const MAX_INVENTORY_ENTRIES = 50_000
const MAX_MANIFEST_FILES = 20_000
const HASH_BUFFER_BYTES = 1024 * 1024

export class ImportManifestSealError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: string | null = null,
  ) {
    super(message)
    this.name = 'ImportManifestSealError'
  }
}

export interface ImportManifestSealOptions {
  datasetRoot: string
  request: BitrixSnapshotSealRequest
  privateKey: KeyObject
  onProgress?: (progress: { completedFiles: number; totalFiles: number; path: string }) => void
}

export interface ImportManifestSealReport {
  sealed: true
  changed: boolean
  manifestSha256: string
  dataset: {
    datasetId: string
    snapshotId: string
    kind: 'SNAPSHOT' | 'DELTA'
    sequence: number
    signerId: string
    signingKeyId: string
  }
  counters: {
    files: number
    bytes: number
  }
  validation: ImportManifestValidationReport
}

type HashedDatasetFile = ImportManifestFile
type FileIdentity = { dev: number; ino: number }

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === ''
    || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
}

function sourceTypeFor(path: string): string {
  const [scope, entity] = path.split('/')
  if (scope === 'canonical') return `canonical/${entity ?? 'unknown'}`
  if (scope === 'source-schema') return 'source-schema'
  if (scope === 'reports') return `report/${entity?.replace(/\.[^.]+$/, '') ?? 'unknown'}`
  if (path === 'files/manifest.ndjson.zst') return 'file-manifest'
  if (path === 'files/tombstones.ndjson.zst') return 'file-tombstones'
  return 'file-content'
}

async function readBoundedStableFile(path: string, maxBytes: number, errorCode: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const pathStat = await lstat(path)
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink > 1 || pathStat.size > maxBytes) {
      throw new ImportManifestSealError(errorCode, 'Configured sealing input is not a safe bounded regular file.')
    }
    handle = await open(path, 'r')
    const before = await handle.stat()
    const buffer = Buffer.allocUnsafe(before.size)
    let offset = 0
    while (offset < buffer.byteLength) {
      const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    const after = await handle.stat()
    if (
      offset !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.dev !== before.dev
      || after.ino !== before.ino
    ) {
      throw new ImportManifestSealError(errorCode, 'Configured sealing input changed while it was being read.')
    }
    return buffer
  } catch (error) {
    if (error instanceof ImportManifestSealError) throw error
    throw new ImportManifestSealError(errorCode, 'Configured sealing input cannot be read safely.')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function loadBitrixSnapshotSealRequest(path: string): Promise<BitrixSnapshotSealRequest> {
  const bytes = await readBoundedStableFile(path, MAX_REQUEST_BYTES, 'SEAL_REQUEST_UNREADABLE')
  let raw: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    assertNoDuplicateJsonKeys(text)
    raw = JSON.parse(text)
  } catch {
    throw new ImportManifestSealError(
      'SEAL_REQUEST_JSON_INVALID',
      'Seal request must be strict UTF-8 JSON without duplicate object keys.',
    )
  }
  const parsed = bitrixSnapshotSealRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ImportManifestSealError(
      'SEAL_REQUEST_SCHEMA_INVALID',
      `Seal request does not match the v1 contract (${parsed.error.issues.length} issue(s)).`,
    )
  }
  return parsed.data
}

export async function loadEd25519PrivateKey(path: string): Promise<KeyObject> {
  const bytes = await readBoundedStableFile(path, MAX_PRIVATE_KEY_BYTES, 'SEAL_PRIVATE_KEY_UNREADABLE')
  try {
    const key = createPrivateKey(bytes)
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new ImportManifestSealError('SEAL_PRIVATE_KEY_INVALID', 'Signing key must be an Ed25519 private key.')
    }
    return key
  } catch (error) {
    if (error instanceof ImportManifestSealError) throw error
    throw new ImportManifestSealError('SEAL_PRIVATE_KEY_INVALID', 'Signing key must be a valid Ed25519 private key.')
  }
}

async function hashStableDatasetFile(root: string, relativePath: string): Promise<HashedDatasetFile> {
  const candidate = resolve(root, ...relativePath.split('/'))
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const resolvedBefore = await realpath(candidate)
    if (!isWithin(root, resolvedBefore)) {
      throw new ImportManifestSealError('SEAL_FILE_PATH_ESCAPE', 'Dataset file resolves outside the snapshot root.', relativePath)
    }
    const pathStat = await lstat(candidate)
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new ImportManifestSealError('SEAL_FILE_NOT_REGULAR', 'Dataset entry is not a regular file.', relativePath)
    }
    if (pathStat.nlink > 1) {
      throw new ImportManifestSealError('SEAL_FILE_HARDLINK_UNSUPPORTED', 'Hard-linked dataset files cannot be sealed.', relativePath)
    }
    handle = await open(resolvedBefore, 'r')
    const before = await handle.stat()
    const digest = createHash('sha256')
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES)
    let bytes = 0
    while (bytes < before.size) {
      const result = await handle.read(buffer, 0, Math.min(buffer.byteLength, before.size - bytes), bytes)
      if (result.bytesRead === 0) break
      digest.update(buffer.subarray(0, result.bytesRead))
      bytes += result.bytesRead
    }
    const [resolvedAfter, after] = await Promise.all([realpath(candidate), handle.stat()])
    if (
      resolvedAfter !== resolvedBefore
      || bytes !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.dev !== before.dev
      || after.ino !== before.ino
    ) {
      throw new ImportManifestSealError('SEAL_FILE_CHANGED', 'Dataset file changed while it was being hashed.', relativePath)
    }
    return {
      path: relativePath,
      sourceType: sourceTypeFor(relativePath),
      bytes,
      sha256: digest.digest('hex'),
    }
  } catch (error) {
    if (error instanceof ImportManifestSealError) throw error
    throw new ImportManifestSealError('SEAL_FILE_UNREADABLE', 'Dataset file cannot be read safely.', relativePath)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function inventoryAndHashDataset(
  root: string,
  onProgress?: ImportManifestSealOptions['onProgress'],
): Promise<HashedDatasetFile[]> {
  const pending = [{ absolute: root, relative: '' }]
  const paths: string[] = []
  let entryCount = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    let entries
    try {
      entries = await readdir(current.absolute, { withFileTypes: true })
    } catch {
      throw new ImportManifestSealError('SEAL_DATASET_INVENTORY_UNREADABLE', 'Dataset inventory cannot be read safely.')
    }
    for (const entry of entries) {
      entryCount += 1
      if (entryCount > MAX_INVENTORY_ENTRIES) {
        throw new ImportManifestSealError('SEAL_DATASET_INVENTORY_LIMIT', 'Dataset inventory exceeds the safe entry limit.')
      }
      const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name
      const absolutePath = resolve(current.absolute, entry.name)
      if (entry.isDirectory()) {
        const parsedDirectory = importDatasetRelativePathSchema.safeParse(`${relativePath}/inventory.placeholder`)
        if (!parsedDirectory.success) {
          throw new ImportManifestSealError('SEAL_DATASET_ENTRY_UNSAFE', 'Dataset contains an unsafe directory.')
        }
        pending.push({ absolute: absolutePath, relative: relativePath })
        continue
      }
      if (relativePath === MANIFEST_FILENAME || relativePath === CHECKSUMS_FILENAME) continue
      const parsedPath = importDatasetRelativePathSchema.safeParse(relativePath)
      if (!entry.isFile() || !parsedPath.success) {
        throw new ImportManifestSealError('SEAL_DATASET_ENTRY_UNSAFE', 'Dataset contains an unsafe filesystem entry.')
      }
      paths.push(parsedPath.data)
      if (paths.length > MAX_MANIFEST_FILES - 1) {
        throw new ImportManifestSealError('SEAL_DATASET_FILE_LIMIT', 'Dataset exceeds the signed file-count limit.')
      }
    }
  }
  paths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  const files: HashedDatasetFile[] = []
  let totalBytes = 0
  for (const path of paths) {
    const file = await hashStableDatasetFile(root, path)
    totalBytes += file.bytes
    if (!Number.isSafeInteger(totalBytes)) {
      throw new ImportManifestSealError('SEAL_DATASET_BYTES_UNSAFE', 'Dataset aggregate byte count exceeds the safe integer limit.')
    }
    files.push(file)
    onProgress?.({ completedFiles: files.length, totalFiles: paths.length, path })
  }
  return files
}

async function existingOutputMatches(path: string, expected: Buffer): Promise<boolean | null> {
  try {
    await stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new ImportManifestSealError('SEAL_OUTPUT_UNREADABLE', 'Existing seal output cannot be inspected safely.')
  }
  const bytes = await readBoundedStableFile(path, Math.max(expected.byteLength, 1) + 1, 'SEAL_OUTPUT_UNREADABLE')
  return bytes.equals(expected)
}

async function assertDatasetRootStable(root: string, identity: FileIdentity): Promise<void> {
  const current = await stat(root).catch(() => null)
  if (!current || current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new ImportManifestSealError('SEAL_DATASET_ROOT_CHANGED', 'Dataset root changed while it was being sealed.')
  }
}

async function atomicallyCreateOutput(
  root: string,
  rootIdentity: FileIdentity,
  path: string,
  bytes: Buffer,
): Promise<FileIdentity> {
  const parent = dirname(path)
  try {
    if (relative(root, await realpath(parent)) !== '') {
      throw new ImportManifestSealError('SEAL_DATASET_ROOT_CHANGED', 'Dataset root changed before seal output was created.')
    }
    await assertDatasetRootStable(root, rootIdentity)
  } catch (error) {
    if (error instanceof ImportManifestSealError) throw error
    throw new ImportManifestSealError('SEAL_DATASET_ROOT_CHANGED', 'Dataset root changed before seal output was created.')
  }
  const temporaryDirectory = await mkdtemp(join(dirname(parent), '.lankadws-seal-'))
  const temporaryPath = join(temporaryDirectory, 'output')
  let targetIdentity: FileIdentity | null = null
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx' })
    const temporaryStat = await stat(temporaryPath)
    await link(temporaryPath, path)
    targetIdentity = { dev: temporaryStat.dev, ino: temporaryStat.ino }
    await unlink(temporaryPath)
    return targetIdentity
  } catch (error) {
    if (targetIdentity) {
      const current = await stat(path).catch(() => null)
      if (current?.dev === targetIdentity.dev && current.ino === targetIdentity.ino) {
        await unlink(path).catch(() => undefined)
      }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ImportManifestSealError('SEAL_OUTPUT_RACE', 'Seal output appeared concurrently; no file was overwritten.')
    }
    if (error instanceof ImportManifestSealError) throw error
    throw new ImportManifestSealError('SEAL_OUTPUT_WRITE_FAILED', 'Seal output could not be created safely.')
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function sealImportManifest(options: ImportManifestSealOptions): Promise<ImportManifestSealReport> {
  const parsedRequest = bitrixSnapshotSealRequestSchema.safeParse(options.request)
  if (!parsedRequest.success) {
    throw new ImportManifestSealError(
      'SEAL_REQUEST_SCHEMA_INVALID',
      `Seal request does not match the v1 contract (${parsedRequest.error.issues.length} issue(s)).`,
    )
  }
  if (options.privateKey.asymmetricKeyType !== 'ed25519') {
    throw new ImportManifestSealError('SEAL_PRIVATE_KEY_INVALID', 'Signing key must be an Ed25519 private key.')
  }

  let root: string
  let rootIdentity: FileIdentity
  try {
    const configuredRoot = resolve(options.datasetRoot)
    const configuredStat = await lstat(configuredRoot)
    if (!configuredStat.isDirectory() || configuredStat.isSymbolicLink()) {
      throw new Error('invalid')
    }
    root = await realpath(configuredRoot)
    const rootStat = await stat(root)
    rootIdentity = { dev: rootStat.dev, ino: rootStat.ino }
  } catch {
    throw new ImportManifestSealError('SEAL_DATASET_ROOT_INVALID', 'Dataset root must be a real readable directory.')
  }

  const sourceFiles = await inventoryAndHashDataset(root, options.onProgress)
  const checksumBytes = Buffer.from(
    `${sourceFiles.map((file) => `${file.sha256}  ${file.path}`).join('\n')}\n`,
    'utf8',
  )
  const checksumFile: ImportManifestFile = {
    path: CHECKSUMS_FILENAME,
    sourceType: 'checksum-manifest',
    bytes: checksumBytes.byteLength,
    sha256: sha256(checksumBytes),
  }
  const parsedPayload = bitrixSnapshotManifestPayloadSchema.safeParse({
    ...parsedRequest.data.payload,
    files: [
      ...sourceFiles.map((file) => ({
        path: file.path,
        sourceType: file.sourceType,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      checksumFile,
    ],
  })
  if (!parsedPayload.success) {
    throw new ImportManifestSealError(
      'SEAL_DATASET_CONTRACT_INCOMPLETE',
      `Dataset cannot satisfy the signed manifest v1 contract (${parsedPayload.error.issues.length} issue(s)).`,
    )
  }
  const payload = parsedPayload.data
  const signingBytes = importManifestSigningBytes(payload, parsedRequest.data.signing)
  const parsedManifest = bitrixSnapshotManifestSchema.safeParse({
    payload,
    signing: {
      ...parsedRequest.data.signing,
      signedPayloadSha256: sha256(signingBytes),
      signature: signBytes(null, signingBytes, options.privateKey).toString('base64url'),
    },
  } satisfies BitrixSnapshotManifest)
  if (!parsedManifest.success) {
    throw new ImportManifestSealError(
      'SEAL_MANIFEST_CONTRACT_INVALID',
      `Generated manifest does not match the v1 contract (${parsedManifest.error.issues.length} issue(s)).`,
    )
  }
  const manifest = parsedManifest.data
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const checksumPath = resolve(root, CHECKSUMS_FILENAME)
  const manifestPath = resolve(root, MANIFEST_FILENAME)
  const [checksumMatch, manifestMatch] = await Promise.all([
    existingOutputMatches(checksumPath, checksumBytes),
    existingOutputMatches(manifestPath, manifestBytes),
  ])
  if (checksumMatch === false || manifestMatch === false) {
    throw new ImportManifestSealError(
      'SEAL_OUTPUT_MISMATCH',
      'Existing seal output does not match the current dataset, metadata and signing key; no file was overwritten.',
    )
  }
  await assertDatasetRootStable(root, rootIdentity)

  const created: Array<{ path: string; identity: FileIdentity }> = []
  try {
    if (checksumMatch === null) {
      created.push({
        path: checksumPath,
        identity: await atomicallyCreateOutput(root, rootIdentity, checksumPath, checksumBytes),
      })
    }
    if (manifestMatch === null) {
      created.push({
        path: manifestPath,
        identity: await atomicallyCreateOutput(root, rootIdentity, manifestPath, manifestBytes),
      })
    }
    await assertDatasetRootStable(root, rootIdentity)
    const publicKey = createPublicKey(options.privateKey).export({ type: 'spki', format: 'pem' }).toString()
    const validation = await validateImportManifest({
      datasetRoot: root,
      trustedSigningKeys: { [parsedRequest.data.signing.keyId]: publicKey },
    })
    if (!validation.valid || !validation.manifestSha256) {
      throw new ImportManifestSealError(
        'SEAL_ROUND_TRIP_INVALID',
        `Generated manifest failed its verifier round trip (${validation.issues.length} issue(s)).`,
      )
    }
    await assertDatasetRootStable(root, rootIdentity)
    return {
      sealed: true,
      changed: created.length > 0,
      manifestSha256: validation.manifestSha256,
      dataset: {
        datasetId: payload.datasetId,
        snapshotId: payload.snapshotId,
        kind: payload.kind,
        sequence: payload.sequence,
        signerId: parsedRequest.data.signing.signerId,
        signingKeyId: parsedRequest.data.signing.keyId,
      },
      counters: {
        files: payload.files.length,
        bytes: payload.files.reduce((total, file) => total + file.bytes, 0),
      },
      validation,
    }
  } catch (error) {
    for (const output of created.reverse()) {
      const current = await stat(output.path).catch(() => null)
      if (current?.dev === output.identity.dev && current.ino === output.identity.ino) {
        await unlink(output.path).catch(() => undefined)
      }
    }
    throw error
  }
}
