import { z } from 'zod'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i)
const boundedIdentifierSchema = z.string().trim().min(1).max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:@/+ -]*$/, 'Identifier must be safe printable ASCII')

export const importDatasetKindSchema = z.enum(['SNAPSHOT', 'DELTA'])
export type ImportDatasetKind = z.infer<typeof importDatasetKindSchema>

export const importDatasetStatusSchema = z.enum(['INGESTING', 'SEALED', 'INVALID'])
export type ImportDatasetStatus = z.infer<typeof importDatasetStatusSchema>

export const importRunModeSchema = z.enum(['VALIDATE', 'DRY_RUN', 'APPLY'])
export type ImportRunMode = z.infer<typeof importRunModeSchema>

export const importRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
])
export type ImportRunStatus = z.infer<typeof importRunStatusSchema>

export const importIssueSeveritySchema = z.enum(['WARNING', 'BLOCKING'])
export type ImportIssueSeverity = z.infer<typeof importIssueSeveritySchema>

export const importReadinessStateSchema = z.enum(['BLOCKED', 'READY_FOR_REHEARSAL'])
export type ImportReadinessState = z.infer<typeof importReadinessStateSchema>

export const importGateStatusSchema = z.enum(['BLOCKING', 'READY'])
export type ImportGateStatus = z.infer<typeof importGateStatusSchema>

export const importDatasetRelativePathSchema = z.string().min(1).max(500).refine((value) => {
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  if (/^[a-zA-Z]:/.test(value) || !/^[a-z0-9._/-]+$/.test(value)) return false
  const segments = value.split('/')
  if (segments.some((segment) => (
    !segment
    || segment === '.'
    || segment === '..'
    || segment.endsWith('.')
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(segment)
  ))) return false
  return value === 'checksums.sha256'
    || value.startsWith('source-schema/')
    || value.startsWith('canonical/')
    || value.startsWith('files/')
    || value.startsWith('reports/')
}, 'Dataset path must be a safe allowlisted relative path')
export type ImportDatasetRelativePath = z.infer<typeof importDatasetRelativePathSchema>
export const importManifestReportPathSchema = z.union([
  z.literal('snapshot-manifest.json'),
  importDatasetRelativePathSchema,
])

export const importManifestFileSchema = z.object({
  path: importDatasetRelativePathSchema,
  sourceType: boundedIdentifierSchema,
  bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: sha256Schema,
  recordCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
}).strict()
export type ImportManifestFile = z.infer<typeof importManifestFileSchema>

const importWatermarkSchema = z.record(
  z.string().min(1).max(120)
    .regex(/^[a-zA-Z0-9._:-]+$/)
    .refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key)),
  z.json(),
)

const sourceOrgUnitKeySchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/)
const targetWorkspaceIdSchema = z.string().regex(/^ws_[a-zA-Z0-9_-]+$/)
const targetCompanyIdSchema = z.string().regex(/^cmp_[a-zA-Z0-9_-]+$/)
const targetCompanyCodeSchema = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const companyMappingApprovalRoleSchema = z.enum(['PRODUCT', 'SECURITY', 'DATA'])
export type CompanyMappingApprovalRole = z.infer<typeof companyMappingApprovalRoleSchema>

export const companyMappingArtifactSchema = z.object({
  artifactVersion: z.literal(1),
  decisionId: z.literal('D-024'),
  sourceSystem: z.literal('bitrix24'),
  sourceTenantId: boundedIdentifierSchema,
  sourceBuild: z.literal('20.0.1198'),
  targetWorkspaceId: targetWorkspaceIdSchema,
  companyMappingVersion: z.number().int().positive(),
  mappingPolicyVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  sourceInventorySha256: sha256Schema,
  resolutionPrecedence: z.tuple([
    z.literal('AUTHORITATIVE_SOURCE_MARKER'),
    z.literal('OWNING_MAPPED_GROUP'),
    z.literal('APPROVED_ORG_UNIT'),
    z.literal('BLOCK_AMBIGUOUS'),
  ]),
  fallbackPolicy: z.literal('AUTHORITATIVE_ONLY'),
  crossCompanyEntities: z.object({
    policy: z.literal('BLOCK_AND_QUARANTINE'),
    detectedEntityCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    evidenceSha256: sha256Schema,
  }).strict(),
  roots: z.array(z.object({
    sourceOrgUnitKey: sourceOrgUnitKeySchema,
    sourceOrgUnitFingerprint: sha256Schema,
    branchKind: z.enum(['LEGAL', 'PROJECT', 'ORG_SUBTREE']),
    includeDescendants: z.boolean(),
    resolution: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('MAP'),
        targetCompanyId: targetCompanyIdSchema,
        targetCompanyCode: targetCompanyCodeSchema,
      }).strict(),
      z.object({
        kind: z.literal('QUARANTINE'),
        reasonCode: boundedIdentifierSchema,
      }).strict(),
    ]),
  }).strict()).min(1).max(10_000),
  approvals: z.array(z.object({
    role: companyMappingApprovalRoleSchema,
    evidenceId: boundedIdentifierSchema,
    approvedAt: z.string().datetime(),
  }).strict()).length(3),
}).strict().superRefine((value, context) => {
  const sourceKeys = value.roots.map((root) => root.sourceOrgUnitKey)
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    context.addIssue({ code: 'custom', path: ['roots'], message: 'Source organization roots must be unique' })
  }
  const targetIdsByCode = new Map<string, string>()
  const targetCodesById = new Map<string, string>()
  for (const root of value.roots) {
    if (root.resolution.kind !== 'MAP') continue
    const existingId = targetIdsByCode.get(root.resolution.targetCompanyCode)
    const existingCode = targetCodesById.get(root.resolution.targetCompanyId)
    if (
      (existingId && existingId !== root.resolution.targetCompanyId)
      || (existingCode && existingCode !== root.resolution.targetCompanyCode)
    ) {
      context.addIssue({ code: 'custom', path: ['roots'], message: 'Target company IDs and codes must have a stable one-to-one mapping' })
    }
    targetIdsByCode.set(root.resolution.targetCompanyCode, root.resolution.targetCompanyId)
    targetCodesById.set(root.resolution.targetCompanyId, root.resolution.targetCompanyCode)
  }
  const approvalRoles = value.approvals.map((approval) => approval.role)
  if (new Set(approvalRoles).size !== approvalRoles.length) {
    context.addIssue({ code: 'custom', path: ['approvals'], message: 'Company mapping approval roles must be unique' })
  }
  for (const requiredRole of companyMappingApprovalRoleSchema.options) {
    if (!approvalRoles.includes(requiredRole)) {
      context.addIssue({ code: 'custom', path: ['approvals'], message: `Missing company mapping approval: ${requiredRole}` })
    }
  }
  if (value.approvals.some((approval) => Date.parse(approval.approvedAt) > Date.parse(value.generatedAt))) {
    context.addIssue({ code: 'custom', path: ['approvals'], message: 'Company mapping approvals cannot postdate artifact generation' })
  }
})
export type CompanyMappingArtifact = z.infer<typeof companyMappingArtifactSchema>

const bitrixSnapshotManifestMetadataShape = {
  manifestVersion: z.literal(1),
  datasetId: boundedIdentifierSchema,
  snapshotId: boundedIdentifierSchema,
  sourceSystem: z.literal('bitrix24'),
  sourceTenantId: boundedIdentifierSchema,
  sourceBuild: z.literal('20.0.1198'),
  perconaVersion: z.literal('5.7.26-29-log'),
  sourceSchemaFingerprint: sha256Schema,
  charset: z.literal('utf8'),
  collation: z.literal('utf8_unicode_ci'),
  systemTimezone: z.literal('MSK'),
  captureStartedAt: z.string().datetime(),
  captureEndedAt: z.string().datetime(),
  sourceCoordinates: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('BINLOG'),
      file: boundedIdentifierSchema,
      position: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }).strict(),
    z.object({
      kind: z.literal('UNAVAILABLE'),
      reason: z.string().trim().min(10).max(500),
    }).strict(),
  ]),
  databaseSnapshotId: boundedIdentifierSchema,
  uploadSnapshotId: boundedIdentifierSchema,
  tableAllowlistVersion: z.number().int().positive(),
  exclusionRuleVersion: z.number().int().positive(),
  companyMappingVersion: z.number().int().positive(),
  mappingVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  exporterVersion: z.number().int().positive(),
  kind: importDatasetKindSchema,
  parentDatasetId: boundedIdentifierSchema.nullable(),
  sequence: z.number().int().nonnegative(),
  watermarkFrom: importWatermarkSchema.nullable(),
  watermarkTo: importWatermarkSchema,
  encryptionKeyId: boundedIdentifierSchema,
}

const bitrixSnapshotManifestMetadataObjectSchema = z.object(bitrixSnapshotManifestMetadataShape).strict()
type BitrixSnapshotManifestMetadataInput = z.infer<typeof bitrixSnapshotManifestMetadataObjectSchema>

function validateBitrixSnapshotManifestMetadata(
  value: BitrixSnapshotManifestMetadataInput,
  context: z.RefinementCtx,
): void {
  if (Date.parse(value.captureEndedAt) < Date.parse(value.captureStartedAt)) {
    context.addIssue({ code: 'custom', path: ['captureEndedAt'], message: 'Capture end must not precede capture start' })
  }
  if (value.kind === 'SNAPSHOT' && (value.parentDatasetId !== null || value.watermarkFrom !== null)) {
    context.addIssue({ code: 'custom', path: ['kind'], message: 'Snapshot cannot have a parent or watermarkFrom' })
  }
  if (value.kind === 'DELTA' && (!value.parentDatasetId || value.watermarkFrom === null || value.sequence < 1)) {
    context.addIssue({ code: 'custom', path: ['kind'], message: 'Delta requires parentDatasetId, watermarkFrom and positive sequence' })
  }
}

export const bitrixSnapshotManifestMetadataSchema = bitrixSnapshotManifestMetadataObjectSchema
  .superRefine(validateBitrixSnapshotManifestMetadata)
export type BitrixSnapshotManifestMetadata = z.infer<typeof bitrixSnapshotManifestMetadataSchema>

export const importManifestSigningDescriptorSchema = z.object({
  signerId: boundedIdentifierSchema,
  keyId: boundedIdentifierSchema,
  algorithm: z.literal('ED25519'),
}).strict()
export type ImportManifestSigningDescriptor = z.infer<typeof importManifestSigningDescriptorSchema>

export const bitrixSnapshotSealRequestSchema = z.object({
  requestVersion: z.literal(1),
  payload: bitrixSnapshotManifestMetadataSchema,
  signing: importManifestSigningDescriptorSchema,
}).strict()
export type BitrixSnapshotSealRequest = z.infer<typeof bitrixSnapshotSealRequestSchema>

export const bitrixSnapshotManifestPayloadSchema = z.object({
  ...bitrixSnapshotManifestMetadataShape,
  files: z.array(importManifestFileSchema).min(1).max(20_000),
}).strict().superRefine((value, context) => {
  validateBitrixSnapshotManifestMetadata(value, context)
  const paths = value.files.map((file) => file.path)
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'Manifest file paths must be unique across portable filesystems' })
  }
  const declaredBytes = value.files.reduce((total, file) => total + file.bytes, 0)
  if (!Number.isSafeInteger(declaredBytes)) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'Manifest total bytes must be a safe integer' })
  }
  for (const required of [
    'source-schema/ddl.sql',
    'source-schema/columns.ndjson',
    'source-schema/indexes.ndjson',
    'reports/source-counts.json',
    'reports/exclusions.json',
    'reports/relations.json',
    'reports/acl-probes.json',
    'reports/compatibility.json',
    'reports/company-mapping.json',
    'files/manifest.ndjson.zst',
    'files/tombstones.ndjson.zst',
    'checksums.sha256',
  ]) {
    if (!paths.includes(required)) {
      context.addIssue({ code: 'custom', path: ['files'], message: `Required dataset file is missing: ${required}` })
    }
  }
})
export type BitrixSnapshotManifestPayload = z.infer<typeof bitrixSnapshotManifestPayloadSchema>

export const bitrixSnapshotManifestSchema = z.object({
  payload: bitrixSnapshotManifestPayloadSchema,
  signing: z.object({
    ...importManifestSigningDescriptorSchema.shape,
    signedPayloadSha256: sha256Schema,
    signature: z.string().regex(/^[a-zA-Z0-9_-]{80,120}$/),
  }).strict(),
}).strict()
export type BitrixSnapshotManifest = z.infer<typeof bitrixSnapshotManifestSchema>

export const importManifestIssueSchema = z.object({
  code: boundedIdentifierSchema,
  severity: importIssueSeveritySchema,
  path: importManifestReportPathSchema.nullable(),
  detail: z.string().min(1).max(500),
})
export type ImportManifestIssue = z.infer<typeof importManifestIssueSchema>

export const importManifestValidationReportSchema = z.object({
  valid: z.boolean(),
  manifestSha256: sha256Schema.nullable(),
  dataset: z.object({
    datasetId: boundedIdentifierSchema,
    snapshotId: boundedIdentifierSchema,
    sourceSystem: z.literal('bitrix24'),
    sourceTenantId: boundedIdentifierSchema,
    sourceBuild: boundedIdentifierSchema,
    kind: importDatasetKindSchema,
    sequence: z.number().int().nonnegative(),
    companyMappingVersion: z.number().int().positive(),
    mappingVersion: z.number().int().positive(),
    schemaVersion: z.number().int().positive(),
    exporterVersion: z.number().int().positive(),
    signerId: boundedIdentifierSchema,
    signingKeyId: boundedIdentifierSchema,
  }).nullable(),
  companyMapping: z.object({
    version: z.number().int().positive(),
    sourceRoots: z.number().int().min(1).max(10_000),
    mappedRoots: z.number().int().min(0).max(10_000),
    quarantinedRoots: z.number().int().min(0).max(10_000),
    targetCompanies: z.number().int().min(0).max(10_000),
    approvals: z.number().int().min(0).max(3),
    crossCompanyEntities: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict().nullable(),
  counters: z.object({
    declaredFiles: z.number().int().min(0).max(20_000),
    verifiedFiles: z.number().int().min(0).max(20_000),
    declaredBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    verifiedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  files: z.array(z.object({
    path: importDatasetRelativePathSchema,
    status: z.enum(['VERIFIED', 'MISSING', 'INVALID']),
    expectedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    actualBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  })).max(20_000),
  issues: z.array(importManifestIssueSchema).max(100_000),
})
export type ImportManifestValidationReport = z.infer<typeof importManifestValidationReportSchema>

export const importCompanyMappingDatabaseReportSchema = z.object({
  valid: z.boolean(),
  manifestValid: z.boolean(),
  manifestSha256: sha256Schema.nullable(),
  targetWorkspaceId: targetWorkspaceIdSchema.nullable(),
  companyMappingVersion: z.number().int().positive().nullable(),
  counters: z.object({
    signedRoots: z.number().int().min(0).max(10_000),
    activeRows: z.number().int().min(0).max(10_000),
    matchedRows: z.number().int().min(0).max(10_000),
    targetCompanies: z.number().int().min(0).max(10_000),
  }).strict(),
  issues: z.array(importManifestIssueSchema).max(100_000),
}).strict()
export type ImportCompanyMappingDatabaseReport = z.infer<typeof importCompanyMappingDatabaseReportSchema>

export const importReadinessGateSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  status: importGateStatusSchema,
  detail: z.string().min(1).max(500),
})
export type ImportReadinessGate = z.infer<typeof importReadinessGateSchema>

export const importReadinessViewSchema = z.object({
  state: importReadinessStateSchema,
  productionApplyAvailable: z.boolean(),
  controlPlaneVersion: z.number().int().positive(),
  checkedAt: z.string().datetime(),
  counters: z.object({
    datasets: z.number().int().nonnegative(),
    sealedDatasets: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    unresolvedBlockingIssues: z.number().int().nonnegative(),
    activeMappingRows: z.number().int().nonnegative(),
  }),
  gates: z.array(importReadinessGateSchema).min(1),
})
export type ImportReadinessView = z.infer<typeof importReadinessViewSchema>
