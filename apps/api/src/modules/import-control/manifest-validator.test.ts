import {
  importCompanyMappingDatabaseReportSchema,
  importManifestValidationReportSchema,
  type BitrixSnapshotManifest,
  type BitrixSnapshotManifestPayload,
  type ImportManifestFile,
} from '@lankadws/contracts'
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateCompanyMappingAgainstDatabase } from './company-mapping-db-validator.js'
import { importManifestSigningBytes, validateImportManifest } from './manifest-validator.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

interface FixtureOptions {
  omitChecksumPath?: string
  invalidChecksumsUtf8?: boolean
  companyMappingVersion?: number
  quarantinedCompanyRoot?: boolean
  crossCompanyEntityCount?: number
  omitCompanyApproval?: boolean
}

async function writeFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lankadws-import-manifest-'))
  roots.push(root)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyId = 'fixture-ed25519-key'
  const companyMapping = {
    artifactVersion: 1,
    decisionId: 'D-024',
    sourceSystem: 'bitrix24',
    sourceTenantId: 'b24.lankadwscompany.org',
    sourceBuild: '20.0.1198',
    targetWorkspaceId: 'ws_lankadws',
    companyMappingVersion: options.companyMappingVersion ?? 1,
    mappingPolicyVersion: 1,
    generatedAt: '2026-07-23T07:30:00.000Z',
    sourceInventorySha256: '2'.repeat(64),
    resolutionPrecedence: [
      'AUTHORITATIVE_SOURCE_MARKER',
      'OWNING_MAPPED_GROUP',
      'APPROVED_ORG_UNIT',
      'BLOCK_AMBIGUOUS',
    ],
    fallbackPolicy: 'AUTHORITATIVE_ONLY',
    crossCompanyEntities: {
      policy: 'BLOCK_AND_QUARANTINE',
      detectedEntityCount: options.crossCompanyEntityCount ?? 0,
      evidenceSha256: '3'.repeat(64),
    },
    roots: [{
      sourceOrgUnitKey: 'department-root-1',
      sourceOrgUnitFingerprint: '4'.repeat(64),
      branchKind: 'LEGAL',
      includeDescendants: true,
      resolution: options.quarantinedCompanyRoot
        ? { kind: 'QUARANTINE', reasonCode: 'D024_UNRESOLVED' }
        : { kind: 'MAP', targetCompanyId: 'cmp_lankadws_ua', targetCompanyCode: 'lankadws-ua' },
    }],
    approvals: [
      { role: 'PRODUCT', evidenceId: 'approval-product-1', approvedAt: '2026-07-23T07:00:00.000Z' },
      { role: 'SECURITY', evidenceId: 'approval-security-1', approvedAt: '2026-07-23T07:05:00.000Z' },
      { role: 'DATA', evidenceId: 'approval-data-1', approvedAt: '2026-07-23T07:10:00.000Z' },
    ].slice(0, options.omitCompanyApproval ? 2 : 3),
  }
  const files = new Map<string, Buffer>([
    ['source-schema/ddl.sql', Buffer.from('-- synthetic schema\n', 'utf8')],
    ['source-schema/columns.ndjson', Buffer.from('{"table":"b_user","column":"ID"}\n', 'utf8')],
    ['source-schema/indexes.ndjson', Buffer.from('{"table":"b_user","index":"PRIMARY"}\n', 'utf8')],
    ['canonical/identities/users-000001.ndjson.zst', Buffer.from('synthetic-zstd-user-chunk')],
    ['files/manifest.ndjson.zst', Buffer.from('synthetic-zstd-file-manifest')],
    ['files/tombstones.ndjson.zst', Buffer.from('synthetic-zstd-tombstones')],
    ['reports/source-counts.json', Buffer.from('{"b_user":1}\n', 'utf8')],
    ['reports/exclusions.json', Buffer.from('{"excluded":[]}\n', 'utf8')],
    ['reports/relations.json', Buffer.from('{"broken":[]}\n', 'utf8')],
    ['reports/acl-probes.json', Buffer.from('{"probes":[]}\n', 'utf8')],
    ['reports/compatibility.json', Buffer.from('{"compatible":true}\n', 'utf8')],
    ['reports/company-mapping.json', Buffer.from(`${JSON.stringify(companyMapping)}\n`, 'utf8')],
  ])
  const descriptors: ImportManifestFile[] = []
  for (const [path, bytes] of files) {
    const absolutePath = join(root, ...path.split('/'))
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, bytes)
    descriptors.push({
      path,
      sourceType: path.startsWith('canonical/') ? 'canonical-chunk' : 'migration-evidence',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      recordCount: path.endsWith('.json') ? null : 1,
    })
  }

  const checksumLines = descriptors
    .filter((file) => file.path !== options.omitChecksumPath)
    .map((file) => `${file.sha256}  ${file.path}`)
    .join('\n')
  const checksums = options.invalidChecksumsUtf8
    ? Buffer.from([0xc3, 0x28])
    : Buffer.from(`${checksumLines}\n`, 'utf8')
  await writeFile(join(root, 'checksums.sha256'), checksums)
  descriptors.push({
    path: 'checksums.sha256',
    sourceType: 'checksum-manifest',
    bytes: checksums.byteLength,
    sha256: sha256(checksums),
    recordCount: descriptors.length,
  })

  const payload: BitrixSnapshotManifestPayload = {
    manifestVersion: 1,
    datasetId: 'fixture-dataset-001',
    snapshotId: 'fixture-snapshot-001',
    sourceSystem: 'bitrix24',
    sourceTenantId: 'b24.lankadwscompany.org',
    sourceBuild: '20.0.1198',
    perconaVersion: '5.7.26-29-log',
    sourceSchemaFingerprint: '1'.repeat(64),
    charset: 'utf8',
    collation: 'utf8_unicode_ci',
    systemTimezone: 'MSK',
    captureStartedAt: '2026-07-23T08:00:00.000Z',
    captureEndedAt: '2026-07-23T08:05:00.000Z',
    sourceCoordinates: { kind: 'UNAVAILABLE', reason: 'Synthetic fixture has no source binlog coordinates.' },
    databaseSnapshotId: 'fixture-database-snapshot',
    uploadSnapshotId: 'fixture-upload-snapshot',
    tableAllowlistVersion: 1,
    exclusionRuleVersion: 1,
    companyMappingVersion: 1,
    mappingVersion: 1,
    schemaVersion: 1,
    exporterVersion: 1,
    kind: 'SNAPSHOT',
    parentDatasetId: null,
    sequence: 0,
    watermarkFrom: null,
    watermarkTo: { exportedAt: '2026-07-23T08:05:00.000Z' },
    encryptionKeyId: 'fixture-storage-key',
    files: descriptors,
  }
  const signing = {
    signerId: 'fixture-exporter',
    keyId,
    algorithm: 'ED25519' as const,
  }
  const signingBytes = importManifestSigningBytes(payload, signing)
  const manifest: BitrixSnapshotManifest = {
    payload,
    signing: {
      ...signing,
      signedPayloadSha256: sha256(signingBytes),
      signature: signBytes(null, signingBytes, privateKey).toString('base64url'),
    },
  }
  await writeFile(join(root, 'snapshot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return {
    root,
    keyId,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    manifest,
  }
}

describe('signed Bitrix snapshot manifest validation', () => {
  it('verifies a complete signed fixture without exposing its absolute root', async () => {
    const fixture = await writeFixture()

    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.counters).toMatchObject({
      declaredFiles: fixture.manifest.payload.files.length,
      verifiedFiles: fixture.manifest.payload.files.length,
    })
    expect(report.dataset).toMatchObject({
      datasetId: 'fixture-dataset-001',
      sourceBuild: '20.0.1198',
      signingKeyId: fixture.keyId,
    })
    expect(report.companyMapping).toMatchObject({
      version: 1,
      sourceRoots: 1,
      mappedRoots: 1,
      quarantinedRoots: 0,
      targetCompanies: 1,
      approvals: 3,
      crossCompanyEntities: 0,
    })
    expect(importManifestValidationReportSchema.parse(report)).toEqual(report)
    expect(JSON.stringify(report)).not.toContain(fixture.root)
  })

  it('rejects a content file changed after the manifest was signed', async () => {
    const fixture = await writeFixture()
    await writeFile(join(fixture.root, 'reports', 'source-counts.json'), '{"b_user":2}\n', 'utf8')

    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('FILE_HASH_MISMATCH')
    expect(report.files.find((file) => file.path === 'reports/source-counts.json')?.status).toBe('INVALID')
  })

  it('rejects a size mismatch before attempting an unbounded hash read', async () => {
    const fixture = await writeFixture()
    await writeFile(join(fixture.root, 'reports', 'source-counts.json'), '{"b_user":200}\n', 'utf8')

    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'FILE_SIZE_MISMATCH',
      path: 'reports/source-counts.json',
    }))
  })

  it('fails closed for an untrusted signing key', async () => {
    const fixture = await writeFixture()
    const report = await validateImportManifest({ datasetRoot: fixture.root, trustedSigningKeys: {} })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('MANIFEST_SIGNING_KEY_UNKNOWN')
  })

  it('requires the company mapping artifact version to match the signed dataset', async () => {
    const fixture = await writeFixture({ companyMappingVersion: 2 })
    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('COMPANY_MAPPING_VERSION_MISMATCH')
  })

  it('blocks unresolved organization roots and cross-company entities without exposing source keys', async () => {
    const fixture = await writeFixture({
      quarantinedCompanyRoot: true,
      crossCompanyEntityCount: 2,
    })
    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toEqual(expect.arrayContaining([
      'COMPANY_MAPPING_UNRESOLVED_ROOTS',
      'COMPANY_MAPPING_CROSS_COMPANY_UNRESOLVED',
    ]))
    expect(report.companyMapping).toMatchObject({
      sourceRoots: 1,
      mappedRoots: 0,
      quarantinedRoots: 1,
      crossCompanyEntities: 2,
    })
    expect(JSON.stringify(report)).not.toContain('department-root-1')
  })

  it('requires product, security and data approval evidence for company mapping', async () => {
    const fixture = await writeFixture({ omitCompanyApproval: true })
    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('COMPANY_MAPPING_SCHEMA_INVALID')
    expect(report.companyMapping).toBeNull()
  })

  it('rejects files that are present on disk but absent from the signed inventory', async () => {
    const fixture = await writeFixture()
    await writeFile(join(fixture.root, 'reports', 'undeclared.json'), '{"unexpected":true}\n', 'utf8')

    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'DATASET_EXTRA_FILE',
      path: 'reports/undeclared.json',
    }))
  })

  it('rejects a signature that does not cover the manifest payload', async () => {
    const fixture = await writeFixture()
    const manifestPath = join(fixture.root, 'snapshot-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BitrixSnapshotManifest
    manifest.signing.signature = `${manifest.signing.signature[0] === 'A' ? 'B' : 'A'}${manifest.signing.signature.slice(1)}`
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')

    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('MANIFEST_SIGNATURE_INVALID')
  })

  it('rejects duplicate JSON object keys before signature verification', async () => {
    const fixture = await writeFixture()
    const manifestPath = join(fixture.root, 'snapshot-manifest.json')
    const text = await readFile(manifestPath, 'utf8')
    await writeFile(
      manifestPath,
      text.replace('"manifestVersion": 1,', '"manifestVersion": 1,\n    "manifestVersion": 1,'),
      'utf8',
    )

    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('MANIFEST_JSON_DUPLICATE_KEY')
  })

  it('requires checksums.sha256 to cover every signed child file', async () => {
    const fixture = await writeFixture({ omitChecksumPath: 'source-schema/ddl.sql' })
    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'CHECKSUMS_ENTRY_MISSING',
      path: 'source-schema/ddl.sql',
    }))
  })

  it('decodes checksums.sha256 as strict UTF-8', async () => {
    const fixture = await writeFixture({ invalidChecksumsUtf8: true })
    const report = await validateImportManifest({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toContain('CHECKSUMS_UNREADABLE')
  })
})

describe('signed company mapping database preflight', () => {
  it('accepts an exact active mapping set and binds the lookup to the signed workspace', async () => {
    const fixture = await writeFixture()
    const findActiveMappings = vi.fn().mockResolvedValue([{
      sourceOrgUnitKey: 'department-root-1',
      targetCompanyId: 'cmp_lankadws_ua',
      targetCompany: {
        id: 'cmp_lankadws_ua',
        code: 'lankadws-ua',
        status: 'ACTIVE',
        workspaceId: 'ws_lankadws',
      },
    }])

    const report = await validateCompanyMappingAgainstDatabase({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
      reader: { findActiveMappings },
    })

    expect(report.valid).toBe(true)
    expect(report).toMatchObject({
      manifestValid: true,
      targetWorkspaceId: 'ws_lankadws',
      companyMappingVersion: 1,
      counters: {
        signedRoots: 1,
        activeRows: 1,
        matchedRows: 1,
        targetCompanies: 1,
      },
      issues: [],
    })
    expect(findActiveMappings).toHaveBeenCalledWith({
      workspaceId: 'ws_lankadws',
      sourceSystem: 'bitrix24',
      sourceTenantId: 'b24.lankadwscompany.org',
      version: 1,
      limit: 10_001,
    })
    expect(importCompanyMappingDatabaseReportSchema.parse(report)).toEqual(report)
  })

  it('blocks coverage and target-company drift without exposing source mapping keys', async () => {
    const fixture = await writeFixture()
    const report = await validateCompanyMappingAgainstDatabase({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
      reader: {
        findActiveMappings: () => Promise.resolve([
          {
            sourceOrgUnitKey: 'department-root-1',
            targetCompanyId: 'cmp_lankadws_ua',
            targetCompany: {
              id: 'cmp_lankadws_ua',
              code: 'private-company-code',
              status: 'INACTIVE',
              workspaceId: 'ws_other',
            },
          },
          {
            sourceOrgUnitKey: 'unexpected-private-root',
            targetCompanyId: 'cmp_other',
            targetCompany: {
              id: 'cmp_other',
              code: 'other-private-code',
              status: 'ACTIVE',
              workspaceId: 'ws_lankadws',
            },
          },
        ]),
      },
    })

    expect(report.valid).toBe(false)
    expect(report.issues.map((current) => current.code)).toEqual(expect.arrayContaining([
      'COMPANY_MAPPING_DB_COVERAGE_MISMATCH',
      'COMPANY_MAPPING_TARGET_COMPANY_INVALID',
    ]))
    expect(JSON.stringify(report)).not.toContain('department-root-1')
    expect(JSON.stringify(report)).not.toContain('unexpected-private-root')
    expect(JSON.stringify(report)).not.toContain('private-company-code')
  })

  it('does not query the database until every signed snapshot check passes', async () => {
    const fixture = await writeFixture()
    const findActiveMappings = vi.fn()

    const report = await validateCompanyMappingAgainstDatabase({
      datasetRoot: fixture.root,
      trustedSigningKeys: {},
      reader: { findActiveMappings },
    })

    expect(report.valid).toBe(false)
    expect(report.manifestValid).toBe(false)
    expect(report.targetWorkspaceId).toBeNull()
    expect(report.issues.map((current) => current.code)).toContain('MANIFEST_SIGNING_KEY_UNKNOWN')
    expect(findActiveMappings).not.toHaveBeenCalled()
  })

  it('redacts database failures from the operator report', async () => {
    const fixture = await writeFixture()
    const report = await validateCompanyMappingAgainstDatabase({
      datasetRoot: fixture.root,
      trustedSigningKeys: { [fixture.keyId]: fixture.publicKey },
      reader: {
        findActiveMappings: () => Promise.reject(new Error('SQLITE_ERROR private_table secret-root-key')),
      },
    })

    expect(report.valid).toBe(false)
    expect(report.manifestValid).toBe(true)
    expect(report.issues).toEqual([expect.objectContaining({ code: 'COMPANY_MAPPING_DB_LOOKUP_FAILED' })])
    expect(JSON.stringify(report)).not.toContain('private_table')
    expect(JSON.stringify(report)).not.toContain('secret-root-key')
  })
})
