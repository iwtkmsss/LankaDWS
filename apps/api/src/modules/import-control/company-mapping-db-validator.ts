import {
  type CompanyMappingArtifact,
  type ImportCompanyMappingDatabaseReport,
  type ImportManifestIssue,
} from '@lankadws/contracts'
import {
  validateImportManifest,
  type ManifestValidationEvidence,
  type ManifestValidationProgress,
} from './manifest-validator.js'

const MAX_MAPPING_ROWS = 10_000

export interface ActiveCompanyMappingRow {
  sourceOrgUnitKey: string
  targetCompanyId: string
  targetCompany: {
    id: string
    code: string
    status: string
    workspaceId: string
  }
}

export interface CompanyMappingDatabaseScope {
  workspaceId: string
  sourceSystem: string
  sourceTenantId: string
  version: number
  limit: number
}

export interface CompanyMappingTargetReader {
  findActiveMappings(scope: CompanyMappingDatabaseScope): Promise<ActiveCompanyMappingRow[]>
}

export interface CompanyMappingDatabaseValidationOptions {
  datasetRoot: string
  trustedSigningKeys: Record<string, string>
  reader: CompanyMappingTargetReader
  onProgress?: (progress: ManifestValidationProgress) => void
}

function issue(code: string, detail: string): ImportManifestIssue {
  return { code, severity: 'BLOCKING', path: null, detail }
}

function emptyCounters(): ImportCompanyMappingDatabaseReport['counters'] {
  return {
    signedRoots: 0,
    activeRows: 0,
    matchedRows: 0,
    targetCompanies: 0,
  }
}

function signedMappings(artifact: CompanyMappingArtifact) {
  return artifact.roots.flatMap((root) => (
    root.resolution.kind === 'MAP'
      ? [{
          sourceOrgUnitKey: root.sourceOrgUnitKey,
          targetCompanyId: root.resolution.targetCompanyId,
          targetCompanyCode: root.resolution.targetCompanyCode,
        }]
      : []
  ))
}

export async function validateCompanyMappingAgainstDatabase(
  options: CompanyMappingDatabaseValidationOptions,
): Promise<ImportCompanyMappingDatabaseReport> {
  let evidence: ManifestValidationEvidence | null = null
  const manifestReport = await validateImportManifest({
    datasetRoot: options.datasetRoot,
    trustedSigningKeys: options.trustedSigningKeys,
    onProgress: options.onProgress,
    onValidatedEvidence: (validated) => {
      evidence = validated
    },
  })

  if (!manifestReport.valid || !evidence) {
    return {
      valid: false,
      manifestValid: false,
      manifestSha256: manifestReport.manifestSha256,
      targetWorkspaceId: null,
      companyMappingVersion: null,
      counters: emptyCounters(),
      issues: manifestReport.issues,
    }
  }

  const validatedEvidence: ManifestValidationEvidence = evidence
  const artifact = validatedEvidence.companyMapping
  const expected = signedMappings(artifact)
  const issues: ImportManifestIssue[] = []
  let activeRows: ActiveCompanyMappingRow[]
  try {
    activeRows = await options.reader.findActiveMappings({
      workspaceId: artifact.targetWorkspaceId,
      sourceSystem: validatedEvidence.manifest.payload.sourceSystem,
      sourceTenantId: validatedEvidence.manifest.payload.sourceTenantId,
      version: artifact.companyMappingVersion,
      limit: MAX_MAPPING_ROWS + 1,
    })
  } catch {
    return {
      valid: false,
      manifestValid: true,
      manifestSha256: manifestReport.manifestSha256,
      targetWorkspaceId: artifact.targetWorkspaceId,
      companyMappingVersion: artifact.companyMappingVersion,
      counters: {
        ...emptyCounters(),
        signedRoots: expected.length,
        targetCompanies: new Set(expected.map((mapping) => mapping.targetCompanyId)).size,
      },
      issues: [issue('COMPANY_MAPPING_DB_LOOKUP_FAILED', 'Active company mappings could not be read safely.')],
    }
  }

  if (activeRows.length > MAX_MAPPING_ROWS) {
    issues.push(issue(
      'COMPANY_MAPPING_ACTIVE_ROWS_LIMIT_EXCEEDED',
      `Active company mappings exceed the supported ${MAX_MAPPING_ROWS}-row validation limit.`,
    ))
  }
  const boundedRows = activeRows.slice(0, MAX_MAPPING_ROWS)
  const expectedByRoot = new Map(expected.map((mapping) => [mapping.sourceOrgUnitKey, mapping]))
  const activeByRoot = new Map<string, ActiveCompanyMappingRow>()
  let duplicateRows = 0
  for (const row of boundedRows) {
    if (activeByRoot.has(row.sourceOrgUnitKey)) duplicateRows += 1
    else activeByRoot.set(row.sourceOrgUnitKey, row)
  }

  let missingRows = 0
  let retargetedRows = 0
  let matchedRows = 0
  let invalidTargetCompanies = 0
  for (const mapping of expected) {
    const row = activeByRoot.get(mapping.sourceOrgUnitKey)
    if (!row) {
      missingRows += 1
      continue
    }
    if (row.targetCompanyId !== mapping.targetCompanyId) {
      retargetedRows += 1
      continue
    }
    matchedRows += 1
    if (
      row.targetCompany.id !== mapping.targetCompanyId
      || row.targetCompany.code !== mapping.targetCompanyCode
      || row.targetCompany.workspaceId !== artifact.targetWorkspaceId
      || row.targetCompany.status !== 'ACTIVE'
    ) {
      invalidTargetCompanies += 1
    }
  }
  const unexpectedRows = [...activeByRoot.keys()].filter((root) => !expectedByRoot.has(root)).length

  if (missingRows || retargetedRows || unexpectedRows || duplicateRows) {
    issues.push(issue(
      'COMPANY_MAPPING_DB_COVERAGE_MISMATCH',
      `Signed and active mapping rows differ (missing ${missingRows}, retargeted ${retargetedRows}, unexpected ${unexpectedRows}, duplicate ${duplicateRows}).`,
    ))
  }
  if (invalidTargetCompanies > 0) {
    issues.push(issue(
      'COMPANY_MAPPING_TARGET_COMPANY_INVALID',
      `${invalidTargetCompanies} mapped target company record(s) are inactive or do not match the signed workspace, ID and code.`,
    ))
  }

  return {
    valid: issues.length === 0,
    manifestValid: true,
    manifestSha256: manifestReport.manifestSha256,
    targetWorkspaceId: artifact.targetWorkspaceId,
    companyMappingVersion: artifact.companyMappingVersion,
    counters: {
      signedRoots: expected.length,
      activeRows: boundedRows.length,
      matchedRows,
      targetCompanies: new Set(expected.map((mapping) => mapping.targetCompanyId)).size,
    },
    issues,
  }
}
