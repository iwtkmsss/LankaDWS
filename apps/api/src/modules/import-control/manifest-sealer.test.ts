import type { BitrixSnapshotSealRequest, CompanyMappingArtifact } from '@bert-crm/contracts'
import { generateKeyPairSync } from 'node:crypto'
import { link, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadBitrixSnapshotSealRequest,
  loadEd25519PrivateKey,
  sealImportManifest,
} from './manifest-sealer.js'
import { validateImportManifest } from './manifest-validator.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function companyMapping(overrides: Partial<CompanyMappingArtifact> = {}): CompanyMappingArtifact {
  return {
    artifactVersion: 1,
    decisionId: 'D-024',
    sourceSystem: 'bitrix24',
    sourceTenantId: 'fixture-tenant',
    sourceBuild: '20.0.1198',
    targetWorkspaceId: 'ws_fixture',
    companyMappingVersion: 1,
    mappingPolicyVersion: 1,
    generatedAt: '2026-07-23T10:00:00.000Z',
    sourceInventorySha256: 'a'.repeat(64),
    resolutionPrecedence: [
      'AUTHORITATIVE_SOURCE_MARKER',
      'OWNING_MAPPED_GROUP',
      'APPROVED_ORG_UNIT',
      'BLOCK_AMBIGUOUS',
    ],
    fallbackPolicy: 'AUTHORITATIVE_ONLY',
    crossCompanyEntities: {
      policy: 'BLOCK_AND_QUARANTINE',
      detectedEntityCount: 0,
      evidenceSha256: 'b'.repeat(64),
    },
    roots: [{
      sourceOrgUnitKey: 'root-001',
      sourceOrgUnitFingerprint: 'c'.repeat(64),
      branchKind: 'LEGAL',
      includeDescendants: true,
      resolution: {
        kind: 'MAP',
        targetCompanyId: 'cmp_fixture',
        targetCompanyCode: 'fixture',
      },
    }],
    approvals: [
      { role: 'PRODUCT', evidenceId: 'approval-product', approvedAt: '2026-07-23T09:00:00.000Z' },
      { role: 'SECURITY', evidenceId: 'approval-security', approvedAt: '2026-07-23T09:01:00.000Z' },
      { role: 'DATA', evidenceId: 'approval-data', approvedAt: '2026-07-23T09:02:00.000Z' },
    ],
    ...overrides,
  }
}

function sealRequest(): BitrixSnapshotSealRequest {
  return {
    requestVersion: 1,
    payload: {
      manifestVersion: 1,
      datasetId: 'fixture-dataset-001',
      snapshotId: 'fixture-snapshot-001',
      sourceSystem: 'bitrix24',
      sourceTenantId: 'fixture-tenant',
      sourceBuild: '20.0.1198',
      perconaVersion: '5.7.26-29-log',
      sourceSchemaFingerprint: 'd'.repeat(64),
      charset: 'utf8',
      collation: 'utf8_unicode_ci',
      systemTimezone: 'MSK',
      captureStartedAt: '2026-07-23T08:00:00.000Z',
      captureEndedAt: '2026-07-23T08:05:00.000Z',
      sourceCoordinates: {
        kind: 'UNAVAILABLE',
        reason: 'Synthetic fixture has no source binlog coordinates.',
      },
      databaseSnapshotId: 'database-snapshot-001',
      uploadSnapshotId: 'upload-snapshot-001',
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
      watermarkTo: { tasks: { id: 10 }, files: { id: 4 } },
      encryptionKeyId: 'ops-storage-key-001',
    },
    signing: {
      signerId: 'fixture-exporter',
      keyId: 'fixture-key-001',
      algorithm: 'ED25519',
    },
  }
}

async function createFixture(mapping = companyMapping()) {
  const root = await mkdtemp(join(tmpdir(), 'bert-manifest-sealer-'))
  temporaryRoots.push(root)
  const files = new Map<string, Buffer>([
    ['source-schema/ddl.sql', Buffer.from('CREATE TABLE fixture (id INT PRIMARY KEY);')],
    ['source-schema/columns.ndjson', Buffer.from('{"table":"fixture","column":"id"}\n')],
    ['source-schema/indexes.ndjson', Buffer.from('{"table":"fixture","index":"PRIMARY"}\n')],
    ['reports/source-counts.json', Buffer.from('{"fixture":1}\n')],
    ['reports/exclusions.json', Buffer.from('{"excluded":0}\n')],
    ['reports/relations.json', Buffer.from('{"orphans":0}\n')],
    ['reports/acl-probes.json', Buffer.from('{"passed":1}\n')],
    ['reports/compatibility.json', Buffer.from('{"unsupported":0}\n')],
    ['reports/company-mapping.json', Buffer.from(`${JSON.stringify(mapping, null, 2)}\n`)],
    ['files/manifest.ndjson.zst', Buffer.from('synthetic-zstd-file-manifest')],
    ['files/tombstones.ndjson.zst', Buffer.from('synthetic-zstd-tombstones')],
  ])
  for (const [path, bytes] of files) {
    const absolute = join(root, ...path.split('/'))
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, bytes)
  }
  return root
}

describe('exporter-side signed manifest sealing', () => {
  it('generates deterministic checksums and a manifest accepted by the existing verifier', async () => {
    const root = await createFixture()
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')

    const first = await sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey })
    expect(first.changed).toBe(true)
    expect(first.validation.valid).toBe(true)
    expect(first.counters.files).toBe(12)

    const checksumLines = (await readFile(join(root, 'checksums.sha256'), 'utf8')).trim().split('\n')
    const checksumPaths = checksumLines.map((line) => line.slice(66))
    expect(checksumPaths).toEqual([...checksumPaths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
    expect(checksumPaths).not.toContain('checksums.sha256')

    const verified = await validateImportManifest({
      datasetRoot: root,
      trustedSigningKeys: {
        'fixture-key-001': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    })
    expect(verified.valid).toBe(true)
    expect(verified.manifestSha256).toBe(first.manifestSha256)

    const second = await sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey })
    expect(second.changed).toBe(false)
    expect(second.manifestSha256).toBe(first.manifestSha256)
  })

  it('never overwrites a seal when source content changes', async () => {
    const root = await createFixture()
    const { privateKey } = generateKeyPairSync('ed25519')
    await sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey })
    const originalManifest = await readFile(join(root, 'snapshot-manifest.json'))
    await writeFile(join(root, 'reports/source-counts.json'), '{"fixture":2}\n')

    await expect(sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey }))
      .rejects.toMatchObject({ code: 'SEAL_OUTPUT_MISMATCH' })
    expect(await readFile(join(root, 'snapshot-manifest.json'))).toEqual(originalManifest)
  })

  it('rejects unsafe extra entries before creating any output', async () => {
    const root = await createFixture()
    const { privateKey } = generateKeyPairSync('ed25519')
    await writeFile(join(root, 'operator-notes.txt'), 'must stay outside the sealed dataset')

    await expect(sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey }))
      .rejects.toMatchObject({ code: 'SEAL_DATASET_ENTRY_UNSAFE' })
    await expect(readFile(join(root, 'snapshot-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'checksums.sha256'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects hard-linked export content before signing it', async () => {
    const root = await createFixture()
    const { privateKey } = generateKeyPairSync('ed25519')
    const hardLinkPath = join(root, 'canonical', 'tasks', 'chunk-000001.ndjson.zst')
    await mkdir(join(root, 'canonical', 'tasks'), { recursive: true })
    await link(join(root, 'reports', 'source-counts.json'), hardLinkPath)

    await expect(sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey }))
      .rejects.toMatchObject({ code: 'SEAL_FILE_HARDLINK_UNSUPPORTED' })
  })

  it('rolls back newly created outputs when verifier round-trip gates are not satisfied', async () => {
    const root = await createFixture(companyMapping({
      crossCompanyEntities: {
        policy: 'BLOCK_AND_QUARANTINE',
        detectedEntityCount: 1,
        evidenceSha256: 'b'.repeat(64),
      },
    }))
    const { privateKey } = generateKeyPairSync('ed25519')

    await expect(sealImportManifest({ datasetRoot: root, request: sealRequest(), privateKey }))
      .rejects.toMatchObject({ code: 'SEAL_ROUND_TRIP_INVALID' })
    await expect(readFile(join(root, 'snapshot-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'checksums.sha256'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('parses only strict request JSON and Ed25519 private keys', async () => {
    const supportRoot = await mkdtemp(join(tmpdir(), 'bert-manifest-support-'))
    temporaryRoots.push(supportRoot)
    const requestPath = join(supportRoot, 'request.json')
    const keyPath = join(supportRoot, 'private.pem')
    const request = JSON.stringify(sealRequest()).replace(
      '"requestVersion":1',
      '"requestVersion":1,"requestVersion":1',
    )
    await writeFile(requestPath, request)
    await writeFile(keyPath, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }))

    await expect(loadBitrixSnapshotSealRequest(requestPath))
      .rejects.toMatchObject({ code: 'SEAL_REQUEST_JSON_INVALID' })
    await expect(loadEd25519PrivateKey(keyPath))
      .rejects.toMatchObject({ code: 'SEAL_PRIVATE_KEY_INVALID' })
  })
})
