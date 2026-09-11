import {
  bitrixSnapshotManifestSchema,
  companyMappingArtifactSchema,
  importDatasetRelativePathSchema,
  type BitrixSnapshotManifest,
  type BitrixSnapshotManifestPayload,
  type CompanyMappingArtifact,
  type ImportManifestFile,
  type ImportManifestIssue,
  type ImportManifestValidationReport,
} from '@lankadws/contracts'
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const MANIFEST_FILENAME = 'snapshot-manifest.json'
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_CHECKSUMS_BYTES = 16 * 1024 * 1024
const MAX_COMPANY_MAPPING_BYTES = 4 * 1024 * 1024
const MAX_INVENTORY_ENTRIES = 50_000
const MAX_DETAIL_ISSUES = 1_000
const MAX_CHECKSUM_LINES = 25_000

export interface ManifestValidationProgress {
  completedFiles: number
  declaredFiles: number
  path: string
}

export interface ManifestValidationOptions {
  datasetRoot: string
  trustedSigningKeys: Record<string, string>
  onProgress?: (progress: ManifestValidationProgress) => void
  onValidatedEvidence?: (evidence: ManifestValidationEvidence) => void
}

export interface ManifestValidationEvidence {
  manifest: BitrixSnapshotManifest
  companyMapping: CompanyMappingArtifact
}

interface VerifiedFile {
  report: ImportManifestValidationReport['files'][number]
  resolvedPath: string | null
}

type SigningDescriptor = Pick<BitrixSnapshotManifest['signing'], 'signerId' | 'keyId' | 'algorithm'>

class DuplicateJsonKeyError extends Error {}

export function assertNoDuplicateJsonKeys(text: string): void {
  let index = 0
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

  const skipWhitespace = () => {
    while (index < text.length && /[\t\n\r ]/.test(text[index] ?? '')) index += 1
  }
  const parseString = (): string => {
    const start = index
    index += 1
    while (index < text.length) {
      const character = text[index]
      index += 1
      if (character === '\\') {
        index += 1
      } else if (character === '"') {
        return JSON.parse(text.slice(start, index)) as string
      }
    }
    throw new Error('Unterminated JSON string')
  }
  const parseValue = (): void => {
    skipWhitespace()
    const character = text[index]
    if (character === '{') {
      index += 1
      skipWhitespace()
      const keys = new Set<string>()
      if (text[index] === '}') {
        index += 1
        return
      }
      while (index < text.length) {
        skipWhitespace()
        if (text[index] !== '"') throw new Error('Invalid JSON object key')
        const key = parseString()
        if (keys.has(key)) throw new DuplicateJsonKeyError('Duplicate JSON object key')
        keys.add(key)
        skipWhitespace()
        if (text[index] !== ':') throw new Error('Missing JSON object separator')
        index += 1
        parseValue()
        skipWhitespace()
        if (text[index] === '}') {
          index += 1
          return
        }
        if (text[index] !== ',') throw new Error('Missing JSON object delimiter')
        index += 1
      }
      throw new Error('Unterminated JSON object')
    }
    if (character === '[') {
      index += 1
      skipWhitespace()
      if (text[index] === ']') {
        index += 1
        return
      }
      while (index < text.length) {
        parseValue()
        skipWhitespace()
        if (text[index] === ']') {
          index += 1
          return
        }
        if (text[index] !== ',') throw new Error('Missing JSON array delimiter')
        index += 1
      }
      throw new Error('Unterminated JSON array')
    }
    if (character === '"') {
      parseString()
      return
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length
        return
      }
    }
    numberPattern.lastIndex = index
    const number = numberPattern.exec(text)
    if (!number) throw new Error('Invalid JSON value')
    index = numberPattern.lastIndex
  }

  parseValue()
  skipWhitespace()
  if (index !== text.length) throw new Error('Trailing JSON input')
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number in manifest')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    return `{${entries.join(',')}}`
  }
  throw new Error('Unsupported value in manifest')
}

export function importManifestSigningBytes(
  payload: BitrixSnapshotManifestPayload,
  signing: SigningDescriptor,
): Buffer {
  return Buffer.from(canonicalize({
    payload,
    signing: {
      signerId: signing.signerId,
      keyId: signing.keyId,
      algorithm: signing.algorithm,
    },
  }), 'utf8')
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === ''
    || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
}

function issue(
  code: string,
  detail: string,
  path: ImportManifestIssue['path'] = null,
): ImportManifestIssue {
  return { code, severity: 'BLOCKING', path, detail }
}

function emptyReport(issues: ImportManifestIssue[]): ImportManifestValidationReport {
  return {
    valid: false,
    manifestSha256: null,
    dataset: null,
    companyMapping: null,
    counters: { declaredFiles: 0, verifiedFiles: 0, declaredBytes: 0, verifiedBytes: 0 },
    files: [],
    issues,
  }
}

async function hashFile(path: string, expectedBytes: number): Promise<{ bytes: number; hash: string }> {
  let bytes = 0
  const hash = createHash('sha256')
  if (expectedBytes === 0) return { bytes, hash: hash.digest('hex') }
  for await (const chunk of createReadStream(path, { start: 0, end: expectedBytes - 1 })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    hash.update(buffer)
  }
  return { bytes, hash: hash.digest('hex') }
}

type StableFileReadResult =
  | { status: 'OK'; bytes: Buffer }
  | { status: 'TOO_LARGE' | 'CHANGED' | 'UNREADABLE' }

async function readStableVerifiedFile(
  path: string,
  maxBytes: number,
  expectedHash: string,
): Promise<StableFileReadResult> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const before = await handle.stat()
    if (before.size > maxBytes) return { status: 'TOO_LARGE' }
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    const after = await handle.stat()
    if (
      after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.dev !== before.dev
      || after.ino !== before.ino
      || bytesRead !== after.size
    ) {
      return { status: 'CHANGED' }
    }
    if (bytesRead > maxBytes) return { status: 'TOO_LARGE' }
    const bytes = buffer.subarray(0, bytesRead)
    if (sha256(bytes) !== expectedHash.toLowerCase()) return { status: 'CHANGED' }
    return { status: 'OK', bytes }
  } catch {
    return { status: 'UNREADABLE' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function validateDatasetInventory(
  datasetRoot: string,
  manifest: BitrixSnapshotManifest,
): Promise<ImportManifestIssue[]> {
  const issues: ImportManifestIssue[] = []
  const expectedFiles = new Set<string>([
    MANIFEST_FILENAME,
    ...manifest.payload.files.map((file) => file.path),
  ])
  const pending = [{ absolute: datasetRoot, relative: '' }]
  let entryCount = 0
  const addInventoryIssue = (current: ImportManifestIssue): boolean => {
    if (issues.length < MAX_DETAIL_ISSUES) {
      issues.push(current)
      return false
    }
    issues.push(issue('DATASET_INVENTORY_ISSUES_TRUNCATED', 'Additional dataset inventory issues were omitted.'))
    return true
  }

  try {
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) break
      for (const entry of await readdir(current.absolute, { withFileTypes: true })) {
        entryCount += 1
        if (entryCount > MAX_INVENTORY_ENTRIES) {
          return [issue('DATASET_INVENTORY_LIMIT', 'Dataset filesystem inventory exceeds the safe entry limit.')]
        }
        const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name
        const absolutePath = resolve(current.absolute, entry.name)
        if (entry.isDirectory()) {
          const safeDirectory = importDatasetRelativePathSchema.safeParse(`${relativePath}/inventory.placeholder`)
          if (!safeDirectory.success) {
            if (addInventoryIssue(issue('DATASET_ENTRY_UNSAFE', 'Dataset contains an unsafe or unexpected directory.'))) return issues
            continue
          }
          pending.push({ absolute: absolutePath, relative: relativePath })
          continue
        }
        if (relativePath === MANIFEST_FILENAME) continue
        const parsedPath = importDatasetRelativePathSchema.safeParse(relativePath)
        if (!parsedPath.success) {
          if (addInventoryIssue(issue('DATASET_ENTRY_UNSAFE', 'Dataset contains an unsafe or unexpected filesystem entry.'))) return issues
        } else if (!expectedFiles.has(parsedPath.data)) {
          if (addInventoryIssue(issue('DATASET_EXTRA_FILE', 'Dataset contains a file absent from the signed manifest.', parsedPath.data))) return issues
        }
      }
    }
  } catch {
    issues.push(issue('DATASET_INVENTORY_UNREADABLE', 'Dataset filesystem inventory cannot be read safely.'))
  }
  return issues
}

async function verifyDatasetFile(
  datasetRoot: string,
  file: ImportManifestFile,
): Promise<{ file: VerifiedFile; issues: ImportManifestIssue[] }> {
  const issues: ImportManifestIssue[] = []
  const candidate = resolve(datasetRoot, ...file.path.split('/'))
  if (!isWithin(datasetRoot, candidate)) {
    return {
      file: {
        report: { path: file.path, status: 'INVALID', expectedBytes: file.bytes, actualBytes: null },
        resolvedPath: null,
      },
      issues: [issue('FILE_PATH_ESCAPE', 'Dataset file resolves outside the snapshot root.', file.path)],
    }
  }

  try {
    const resolvedBefore = await realpath(candidate)
    if (!isWithin(datasetRoot, resolvedBefore)) {
      return {
        file: {
          report: { path: file.path, status: 'INVALID', expectedBytes: file.bytes, actualBytes: null },
          resolvedPath: null,
        },
        issues: [issue('FILE_PATH_ESCAPE', 'Dataset file link resolves outside the snapshot root.', file.path)],
      }
    }
    const before = await stat(resolvedBefore)
    if (!before.isFile()) {
      return {
        file: {
          report: { path: file.path, status: 'INVALID', expectedBytes: file.bytes, actualBytes: before.size },
          resolvedPath: null,
        },
        issues: [issue('FILE_NOT_REGULAR', 'Dataset entry is not a regular file.', file.path)],
      }
    }
    if (before.nlink > 1) {
      return {
        file: {
          report: { path: file.path, status: 'INVALID', expectedBytes: file.bytes, actualBytes: before.size },
          resolvedPath: null,
        },
        issues: [issue('FILE_HARDLINK_UNSUPPORTED', 'Hard-linked dataset files require explicit snapshot evidence.', file.path)],
      }
    }
    if (before.size !== file.bytes) {
      return {
        file: {
          report: { path: file.path, status: 'INVALID', expectedBytes: file.bytes, actualBytes: before.size },
          resolvedPath: null,
        },
        issues: [issue('FILE_SIZE_MISMATCH', 'Dataset file size does not match the signed manifest.', file.path)],
      }
    }

    const hashed = await hashFile(resolvedBefore, file.bytes)
    const [resolvedAfter, after] = await Promise.all([realpath(candidate), stat(resolvedBefore)])
    if (
      resolvedAfter !== resolvedBefore
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.dev !== before.dev
      || after.ino !== before.ino
      || hashed.bytes !== after.size
    ) {
      issues.push(issue('FILE_CHANGED_DURING_VALIDATION', 'Dataset file changed while it was being verified.', file.path))
    }
    if (hashed.bytes !== file.bytes) {
      issues.push(issue('FILE_SIZE_MISMATCH', 'Dataset file size does not match the signed manifest.', file.path))
    }
    if (hashed.hash.toLowerCase() !== file.sha256.toLowerCase()) {
      issues.push(issue('FILE_HASH_MISMATCH', 'Dataset file hash does not match the signed manifest.', file.path))
    }
    return {
      file: {
        report: {
          path: file.path,
          status: issues.length ? 'INVALID' : 'VERIFIED',
          expectedBytes: file.bytes,
          actualBytes: hashed.bytes,
        },
        resolvedPath: resolvedBefore,
      },
      issues,
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      file: {
        report: { path: file.path, status: code === 'ENOENT' ? 'MISSING' : 'INVALID', expectedBytes: file.bytes, actualBytes: null },
        resolvedPath: null,
      },
      issues: [
        issue(
          code === 'ENOENT' ? 'FILE_MISSING' : 'FILE_UNREADABLE',
          code === 'ENOENT' ? 'Dataset file is missing.' : 'Dataset file cannot be read safely.',
          file.path,
        ),
      ],
    }
  }
}

async function validateCompanyMapping(
  manifest: BitrixSnapshotManifest,
  verifiedFiles: VerifiedFile[],
): Promise<{
  summary: ImportManifestValidationReport['companyMapping']
  artifact: CompanyMappingArtifact | null
  issues: ImportManifestIssue[]
}> {
  const path = 'reports/company-mapping.json' as const
  const mappingFile = verifiedFiles.find((file) => file.report.path === path)
  if (!mappingFile?.resolvedPath || mappingFile.report.status !== 'VERIFIED') {
    return { summary: null, artifact: null, issues: [] }
  }
  const expectedHash = manifest.payload.files.find((file) => file.path === path)?.sha256
  if (!expectedHash) {
    return {
      summary: null,
      artifact: null,
      issues: [issue('COMPANY_MAPPING_CHANGED_DURING_VALIDATION', 'Company mapping no longer matches the signed manifest.', path)],
    }
  }
  const read = await readStableVerifiedFile(mappingFile.resolvedPath, MAX_COMPANY_MAPPING_BYTES, expectedHash)
  if (read.status !== 'OK') {
    if (read.status === 'TOO_LARGE') {
      return { summary: null, artifact: null, issues: [issue('COMPANY_MAPPING_TOO_LARGE', 'Company mapping exceeds the 4 MiB parser limit.', path)] }
    }
    if (read.status === 'CHANGED') {
      return {
        summary: null,
        artifact: null,
        issues: [issue('COMPANY_MAPPING_CHANGED_DURING_VALIDATION', 'Company mapping no longer matches the signed manifest.', path)],
      }
    }
    return { summary: null, artifact: null, issues: [issue('COMPANY_MAPPING_UNREADABLE', 'Company mapping cannot be read safely.', path)] }
  }

  let raw: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes)
    raw = JSON.parse(text)
    assertNoDuplicateJsonKeys(text)
  } catch (error) {
    return {
      summary: null,
      artifact: null,
      issues: [
        issue(
          error instanceof DuplicateJsonKeyError ? 'COMPANY_MAPPING_JSON_DUPLICATE_KEY' : 'COMPANY_MAPPING_JSON_INVALID',
          error instanceof DuplicateJsonKeyError
            ? 'Company mapping contains a duplicate object key.'
            : 'Company mapping is not strict UTF-8 JSON.',
          path,
        ),
      ],
    }
  }
  let parsed: ReturnType<typeof companyMappingArtifactSchema.safeParse> | null
  try {
    parsed = companyMappingArtifactSchema.safeParse(raw)
  } catch {
    parsed = null
  }
  if (!parsed?.success) {
    return {
      summary: null,
      artifact: null,
      issues: [
        issue(
          'COMPANY_MAPPING_SCHEMA_INVALID',
          `Company mapping does not match the v1 contract (${parsed?.error.issues.length ?? 1} issue(s)).`,
          path,
        ),
      ],
    }
  }

  const artifact = parsed.data
  const targetCompanyIds = artifact.roots.flatMap((root) => (
    root.resolution.kind === 'MAP' ? [root.resolution.targetCompanyId] : []
  ))
  const mappedRootCount = targetCompanyIds.length
  const quarantinedRoots = artifact.roots.length - mappedRootCount
  const summary: NonNullable<ImportManifestValidationReport['companyMapping']> = {
    version: artifact.companyMappingVersion,
    sourceRoots: artifact.roots.length,
    mappedRoots: mappedRootCount,
    quarantinedRoots,
    targetCompanies: new Set(targetCompanyIds).size,
    approvals: artifact.approvals.length,
    crossCompanyEntities: artifact.crossCompanyEntities.detectedEntityCount,
  }
  const issues: ImportManifestIssue[] = []
  if (
    artifact.sourceSystem !== manifest.payload.sourceSystem
    || artifact.sourceTenantId !== manifest.payload.sourceTenantId
    || artifact.sourceBuild !== manifest.payload.sourceBuild
  ) {
    issues.push(issue('COMPANY_MAPPING_SOURCE_MISMATCH', 'Company mapping source identity does not match the signed dataset.', path))
  }
  if (artifact.companyMappingVersion !== manifest.payload.companyMappingVersion) {
    issues.push(issue('COMPANY_MAPPING_VERSION_MISMATCH', 'Company mapping version does not match the signed dataset.', path))
  }
  if (quarantinedRoots > 0) {
    issues.push(issue('COMPANY_MAPPING_UNRESOLVED_ROOTS', 'Company mapping still contains quarantined source roots.', path))
  }
  if (artifact.crossCompanyEntities.detectedEntityCount > 0) {
    issues.push(issue('COMPANY_MAPPING_CROSS_COMPANY_UNRESOLVED', 'Cross-company source entities require an approved resolution before import.', path))
  }
  return { summary, artifact, issues }
}

async function validateChecksums(
  manifest: BitrixSnapshotManifest,
  verifiedFiles: VerifiedFile[],
): Promise<ImportManifestIssue[]> {
  const checksumFile = verifiedFiles.find((file) => file.report.path === 'checksums.sha256')
  if (!checksumFile?.resolvedPath || checksumFile.report.status !== 'VERIFIED') return []
  if ((checksumFile.report.actualBytes ?? 0) > MAX_CHECKSUMS_BYTES) {
    return [issue('CHECKSUMS_TOO_LARGE', 'checksums.sha256 exceeds the safe parser limit.', 'checksums.sha256')]
  }

  try {
    const expectedChecksumHash = manifest.payload.files.find((file) => file.path === 'checksums.sha256')?.sha256
    if (!expectedChecksumHash) {
      return [issue('CHECKSUMS_CHANGED_DURING_VALIDATION', 'checksums.sha256 no longer matches the signed manifest.', 'checksums.sha256')]
    }
    const read = await readStableVerifiedFile(checksumFile.resolvedPath, MAX_CHECKSUMS_BYTES, expectedChecksumHash)
    if (read.status !== 'OK') {
      if (read.status === 'TOO_LARGE') {
        return [issue('CHECKSUMS_TOO_LARGE', 'checksums.sha256 exceeds the safe parser limit.', 'checksums.sha256')]
      }
      if (read.status === 'CHANGED') {
        return [issue('CHECKSUMS_CHANGED_DURING_VALIDATION', 'checksums.sha256 no longer matches the signed manifest.', 'checksums.sha256')]
      }
      return [issue('CHECKSUMS_UNREADABLE', 'checksums.sha256 cannot be read safely.', 'checksums.sha256')]
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes)
    const entries = new Map<string, string>()
    const issues: ImportManifestIssue[] = []
    const addChecksumIssue = (current: ImportManifestIssue): boolean => {
      if (issues.length < MAX_DETAIL_ISSUES) {
        issues.push(current)
        return false
      }
      issues.push(issue('CHECKSUMS_ISSUES_TRUNCATED', 'Additional checksum index issues were omitted.', 'checksums.sha256'))
      return true
    }
    let cursor = 0
    let lineCount = 0
    while (cursor < text.length) {
      const newline = text.indexOf('\n', cursor)
      const end = newline === -1 ? text.length : newline
      const line = text.slice(cursor, end).replace(/\r$/, '')
      cursor = newline === -1 ? text.length : newline + 1
      lineCount += 1
      if (lineCount > MAX_CHECKSUM_LINES) {
        issues.push(issue('CHECKSUMS_ENTRY_LIMIT', 'checksums.sha256 exceeds the safe entry limit.', 'checksums.sha256'))
        return issues
      }
      if (!line) continue
      const match = /^([a-fA-F0-9]{64})[ ]{2}([a-zA-Z0-9._/-]+)$/.exec(line)
      const parsedPath = match ? importDatasetRelativePathSchema.safeParse(match[2]) : null
      if (!match || !parsedPath?.success || parsedPath.data === 'checksums.sha256') {
        if (addChecksumIssue(issue('CHECKSUMS_FORMAT_INVALID', 'checksums.sha256 contains an invalid entry.', 'checksums.sha256'))) return issues
        continue
      }
      if (entries.has(parsedPath.data)) {
        if (addChecksumIssue(issue('CHECKSUMS_DUPLICATE_ENTRY', 'checksums.sha256 contains a duplicate path.', 'checksums.sha256'))) return issues
        continue
      }
      entries.set(parsedPath.data, match[1].toLowerCase())
    }

    const expected = manifest.payload.files.filter((file) => file.path !== 'checksums.sha256')
    for (const file of expected) {
      const checksum = entries.get(file.path)
      if (!checksum) {
        if (addChecksumIssue(issue('CHECKSUMS_ENTRY_MISSING', 'checksums.sha256 is missing a manifest file.', file.path))) return issues
      } else if (checksum !== file.sha256.toLowerCase()) {
        if (addChecksumIssue(issue('CHECKSUMS_HASH_MISMATCH', 'checksums.sha256 disagrees with the signed manifest.', file.path))) return issues
      }
    }
    const declaredPaths = new Set(expected.map((file) => file.path))
    if ([...entries.keys()].some((path) => !declaredPaths.has(path))) {
      addChecksumIssue(issue('CHECKSUMS_EXTRA_ENTRY', 'checksums.sha256 contains a file absent from the signed manifest.', 'checksums.sha256'))
    }
    return issues
  } catch {
    return [issue('CHECKSUMS_UNREADABLE', 'checksums.sha256 cannot be decoded as strict UTF-8.', 'checksums.sha256')]
  }
}

export async function validateImportManifest(
  options: ManifestValidationOptions,
): Promise<ImportManifestValidationReport> {
  let datasetRoot: string
  try {
    datasetRoot = await realpath(resolve(options.datasetRoot))
    if (!(await stat(datasetRoot)).isDirectory()) {
      return emptyReport([issue('DATASET_ROOT_INVALID', 'Configured snapshot root is not a directory.')])
    }
  } catch {
    return emptyReport([issue('DATASET_ROOT_UNREADABLE', 'Configured snapshot root cannot be read.')])
  }

  const manifestPath = resolve(datasetRoot, MANIFEST_FILENAME)
  let manifestBytes: Buffer
  try {
    const resolvedManifest = await realpath(manifestPath)
    if (!isWithin(datasetRoot, resolvedManifest)) {
      return emptyReport([issue('MANIFEST_PATH_ESCAPE', 'Manifest resolves outside the snapshot root.', MANIFEST_FILENAME)])
    }
    const handle = await open(resolvedManifest, 'r')
    try {
      const manifestStat = await handle.stat()
      if (!manifestStat.isFile()) {
        return emptyReport([issue('MANIFEST_NOT_REGULAR', 'snapshot-manifest.json is not a regular file.', MANIFEST_FILENAME)])
      }
      if (manifestStat.nlink > 1) {
        return emptyReport([issue('MANIFEST_HARDLINK_UNSUPPORTED', 'Hard-linked manifests require explicit snapshot evidence.', MANIFEST_FILENAME)])
      }
      if (manifestStat.size > MAX_MANIFEST_BYTES) {
        return emptyReport([issue('MANIFEST_TOO_LARGE', 'snapshot-manifest.json exceeds the 4 MiB parser limit.', MANIFEST_FILENAME)])
      }
      const buffer = Buffer.allocUnsafe(MAX_MANIFEST_BYTES + 1)
      let bytesRead = 0
      while (bytesRead < buffer.byteLength) {
        const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead)
        if (result.bytesRead === 0) break
        bytesRead += result.bytesRead
      }
      const [resolvedAfter, after] = await Promise.all([realpath(manifestPath), handle.stat()])
      if (
        resolvedAfter !== resolvedManifest
        || after.size !== manifestStat.size
        || after.mtimeMs !== manifestStat.mtimeMs
        || after.dev !== manifestStat.dev
        || after.ino !== manifestStat.ino
        || bytesRead !== after.size
      ) {
        return emptyReport([issue('MANIFEST_CHANGED_DURING_VALIDATION', 'snapshot-manifest.json changed while it was being read.', MANIFEST_FILENAME)])
      }
      if (bytesRead > MAX_MANIFEST_BYTES) {
        return emptyReport([issue('MANIFEST_TOO_LARGE', 'snapshot-manifest.json exceeds the 4 MiB parser limit.', MANIFEST_FILENAME)])
      }
      manifestBytes = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return emptyReport([
      issue(
        code === 'ENOENT' ? 'MANIFEST_MISSING' : 'MANIFEST_UNREADABLE',
        code === 'ENOENT' ? 'snapshot-manifest.json is missing.' : 'snapshot-manifest.json cannot be read safely.',
        MANIFEST_FILENAME,
      ),
    ])
  }

  const manifestSha256 = sha256(manifestBytes)
  let rawManifest: unknown
  let manifestText: string
  try {
    manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)
    rawManifest = JSON.parse(manifestText)
  } catch {
    return {
      ...emptyReport([issue('MANIFEST_JSON_INVALID', 'snapshot-manifest.json is not strict UTF-8 JSON.', MANIFEST_FILENAME)]),
      manifestSha256,
    }
  }
  try {
    assertNoDuplicateJsonKeys(manifestText)
  } catch (error) {
    return {
      ...emptyReport([
        issue(
          error instanceof DuplicateJsonKeyError ? 'MANIFEST_JSON_DUPLICATE_KEY' : 'MANIFEST_JSON_INVALID',
          error instanceof DuplicateJsonKeyError
            ? 'snapshot-manifest.json contains a duplicate object key.'
            : 'snapshot-manifest.json is not strict JSON.',
          MANIFEST_FILENAME,
        ),
      ]),
      manifestSha256,
    }
  }
  let parsed: ReturnType<typeof bitrixSnapshotManifestSchema.safeParse> | null
  try {
    parsed = bitrixSnapshotManifestSchema.safeParse(rawManifest)
  } catch {
    parsed = null
  }
  if (!parsed?.success) {
    return {
      ...emptyReport([
        issue(
          'MANIFEST_SCHEMA_INVALID',
          `snapshot-manifest.json does not match the v1 contract (${parsed?.error.issues.length ?? 1} issue(s)).`,
          MANIFEST_FILENAME,
        ),
      ]),
      manifestSha256,
    }
  }
  const manifest = parsed.data
  const issues: ImportManifestIssue[] = []
  let signingBytes: Buffer
  try {
    signingBytes = importManifestSigningBytes(manifest.payload, manifest.signing)
  } catch {
    return {
      ...emptyReport([issue('MANIFEST_CANONICALIZATION_FAILED', 'Manifest cannot be converted to deterministic signing bytes.', MANIFEST_FILENAME)]),
      manifestSha256,
    }
  }
  if (sha256(signingBytes) !== manifest.signing.signedPayloadSha256.toLowerCase()) {
    issues.push(issue('MANIFEST_PAYLOAD_HASH_MISMATCH', 'Signed payload hash does not match the manifest payload.', MANIFEST_FILENAME))
  }
  const publicKey = Object.hasOwn(options.trustedSigningKeys, manifest.signing.keyId)
    ? options.trustedSigningKeys[manifest.signing.keyId]
    : undefined
  if (!publicKey) {
    issues.push(issue('MANIFEST_SIGNING_KEY_UNKNOWN', 'Manifest signing key is not trusted by this environment.', MANIFEST_FILENAME))
  } else {
    try {
      const validSignature = verifySignature(
        null,
        signingBytes,
        createPublicKey(publicKey),
        Buffer.from(manifest.signing.signature, 'base64url'),
      )
      if (!validSignature) {
        issues.push(issue('MANIFEST_SIGNATURE_INVALID', 'Manifest signature verification failed.', MANIFEST_FILENAME))
      }
    } catch {
      issues.push(issue('MANIFEST_SIGNING_KEY_INVALID', 'Configured manifest signing key is invalid.', MANIFEST_FILENAME))
    }
  }

  issues.push(...await validateDatasetInventory(datasetRoot, manifest))
  const verifiedFiles: VerifiedFile[] = []
  for (const [index, file] of manifest.payload.files.entries()) {
    const verified = await verifyDatasetFile(datasetRoot, file)
    verifiedFiles.push(verified.file)
    issues.push(...verified.issues)
    options.onProgress?.({
      completedFiles: index + 1,
      declaredFiles: manifest.payload.files.length,
      path: file.path,
    })
  }
  const companyMapping = await validateCompanyMapping(manifest, verifiedFiles)
  issues.push(...companyMapping.issues)
  issues.push(...await validateChecksums(manifest, verifiedFiles))

  const files = verifiedFiles.map((file) => file.report)
  const verified = files.filter((file) => file.status === 'VERIFIED')
  const report: ImportManifestValidationReport = {
    valid: issues.length === 0,
    manifestSha256,
    dataset: {
      datasetId: manifest.payload.datasetId,
      snapshotId: manifest.payload.snapshotId,
      sourceSystem: manifest.payload.sourceSystem,
      sourceTenantId: manifest.payload.sourceTenantId,
      sourceBuild: manifest.payload.sourceBuild,
      kind: manifest.payload.kind,
      sequence: manifest.payload.sequence,
      companyMappingVersion: manifest.payload.companyMappingVersion,
      mappingVersion: manifest.payload.mappingVersion,
      schemaVersion: manifest.payload.schemaVersion,
      exporterVersion: manifest.payload.exporterVersion,
      signerId: manifest.signing.signerId,
      signingKeyId: manifest.signing.keyId,
    },
    companyMapping: companyMapping.summary,
    counters: {
      declaredFiles: files.length,
      verifiedFiles: verified.length,
      declaredBytes: manifest.payload.files.reduce((total, file) => total + file.bytes, 0),
      verifiedBytes: verified.reduce((total, file) => total + (file.actualBytes ?? 0), 0),
    },
    files,
    issues,
  }
  if (report.valid && companyMapping.artifact) {
    options.onValidatedEvidence?.({ manifest, companyMapping: companyMapping.artifact })
  }
  return report
}
