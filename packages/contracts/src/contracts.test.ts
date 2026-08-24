import { describe, expect, it } from 'vitest'
import {
  OrganizationCapability,
  bitrixSnapshotManifestPayloadSchema,
  bitrixSnapshotSealRequestSchema,
  companyMappingArtifactSchema,
  organizationCapabilityCodeSchema,
  companyScopeSchema,
  chatThreadListQuerySchema,
  chatMessagePageQuerySchema,
  chatMentionCandidatesQuerySchema,
  chatMessageSearchQuerySchema,
  chatThreadPageSchema,
  chatUserSearchQuerySchema,
  addChatParticipantSchema,
  convertChatMessageToEventSchema,
  convertChatMessageToTaskSchema,
  createChatThreadSchema,
  deleteChatMessageSchema,
  editChatMessageSchema,
  markChatReadSchema,
  removeChatParticipantSchema,
  sendChatMessageSchema,
  sendUserNotificationSchema,
  updateChatParticipantSchema,
  updateChatPreferenceSchema,
  createFeedCommentSchema,
  createFeedPostSchema,
  feedMentionCandidatesQuerySchema,
  feedListQuerySchema,
  updateFeedSubscriptionSchema,
  updateFeedPostSchema,
  groupListQuerySchema,
  importDatasetKindSchema,
  importDatasetRelativePathSchema,
  importReadinessViewSchema,
  importRunModeSchema,
  loginInputSchema,
  markFeedReadSchema,
  orgUnitListQuerySchema,
  shareFileToFeedSchema,
  updateOrganizationCapabilitySchema,
  taskCommentInputSchema,
  taskOptionSchema,
  createTaskSchema,
} from './index.js'

const requiredManifestPaths = [
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
]

function validManifestPayload() {
  return {
    manifestVersion: 1,
    datasetId: 'dataset-001',
    snapshotId: 'snapshot-001',
    sourceSystem: 'bitrix24',
    sourceTenantId: 'b24.bertcompany.org',
    sourceBuild: '20.0.1198',
    perconaVersion: '5.7.26-29-log',
    sourceSchemaFingerprint: 'a'.repeat(64),
    charset: 'utf8',
    collation: 'utf8_unicode_ci',
    systemTimezone: 'MSK',
    captureStartedAt: '2026-07-23T08:00:00.000Z',
    captureEndedAt: '2026-07-23T08:05:00.000Z',
    sourceCoordinates: { kind: 'UNAVAILABLE', reason: 'The synthetic fixture has no binlog coordinates.' },
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
    watermarkTo: { exportedAt: '2026-07-23T08:05:00.000Z' },
    encryptionKeyId: 'storage-key-001',
    files: requiredManifestPaths.map((path) => ({
      path,
      sourceType: 'migration-evidence',
      bytes: 1,
      sha256: 'b'.repeat(64),
      recordCount: null,
    })),
  }
}

function validCompanyMappingArtifact() {
  return {
    artifactVersion: 1,
    decisionId: 'D-024',
    sourceSystem: 'bitrix24',
    sourceTenantId: 'b24.bertcompany.org',
    sourceBuild: '20.0.1198',
    targetWorkspaceId: 'ws_bert',
    companyMappingVersion: 1,
    mappingPolicyVersion: 1,
    generatedAt: '2026-07-23T07:30:00.000Z',
    sourceInventorySha256: 'c'.repeat(64),
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
      evidenceSha256: 'd'.repeat(64),
    },
    roots: [{
      sourceOrgUnitKey: 'department-root-1',
      sourceOrgUnitFingerprint: 'e'.repeat(64),
      branchKind: 'LEGAL',
      includeDescendants: true,
      resolution: {
        kind: 'MAP',
        targetCompanyId: 'cmp_bert_ua',
        targetCompanyCode: 'bert-ua',
      },
    }],
    approvals: [
      { role: 'PRODUCT', evidenceId: 'approval-product-1', approvedAt: '2026-07-23T07:00:00.000Z' },
      { role: 'SECURITY', evidenceId: 'approval-security-1', approvedAt: '2026-07-23T07:05:00.000Z' },
      { role: 'DATA', evidenceId: 'approval-data-1', approvedAt: '2026-07-23T07:10:00.000Z' },
    ],
  }
}

describe('transport schemas', () => {
  it('canonicalizes a nickname and rejects email login identifiers', () => {
    expect(loginInputSchema.parse({ username: ' DMY TRO ', password: ' p a s s ' })).toMatchObject({ username: 'dmytro', password: 'pass' })
    expect(() => loginInputSchema.parse({ username: 'dmytro@example.com', password: 'x' })).toThrow()
  })

  it('accepts only explicit company scopes', () => {
    expect(companyScopeSchema.parse('all')).toBe('all')
    expect(companyScopeSchema.parse('cmp_bert')).toBe('cmp_bert')
    expect(() => companyScopeSchema.parse('everything')).toThrow()
  })

  it('keeps capability rollout explicit and company-scoped', () => {
    expect(organizationCapabilityCodeSchema.parse('FEED')).toBe(OrganizationCapability.Feed)
    expect(() => organizationCapabilityCodeSchema.parse('TASKS')).toThrow()
    expect(updateOrganizationCapabilitySchema.parse({ enabled: true, expectedVersion: 2 })).toEqual({
      enabled: true,
      expectedVersion: 2,
    })
  })

  it('normalizes bounded group and organization queries', () => {
    expect(groupListQuerySchema.parse({ company: 'cmp_bert', limit: '20', query: '  design  ' })).toMatchObject({ company: 'cmp_bert', limit: 20, query: 'design', status: 'ACTIVE' })
    expect(() => groupListQuerySchema.parse({ company: 'cmp_bert', limit: 500 })).toThrow()
    expect(orgUnitListQuerySchema.parse({ company: 'cmp_bert', parentId: null })).toEqual({ company: 'cmp_bert', parentId: null })
  })

  it('keeps feed audiences explicit and comment replies flat', () => {
    expect(feedListQuerySchema.parse({
      company: 'cmp_bert',
      filter: 'FOLLOWING',
      type: 'TASK',
      groupId: 'grp_product_design',
      audienceId: 'cmp_bert',
      mentioned: 'true',
      favorite: 'true',
      important: 'false',
      limit: '10',
    })).toMatchObject({
      company: 'cmp_bert',
      filter: 'FOLLOWING',
      type: 'TASK',
      groupId: 'grp_product_design',
      audienceId: 'cmp_bert',
      mentioned: true,
      favorite: true,
      important: false,
      limit: 10,
    })
    expect(() => feedListQuerySchema.parse({
      dateFrom: '2026-08-01',
      dateTo: '2026-07-01',
    })).toThrow()
    expect(updateFeedSubscriptionSchema.parse({ notificationMode: 'MENTIONS' })).toEqual({
      notificationMode: 'MENTIONS',
    })
    expect(() => updateFeedSubscriptionSchema.parse({ notificationMode: 'SOMETIMES' })).toThrow()
    expect(feedListQuerySchema.parse({ type: 'FILE' })).toMatchObject({ type: 'FILE' })
    expect(shareFileToFeedSchema.parse({
      companyId: 'cmp_bert',
      audience: { type: 'USERS', userIds: ['usr_two', 'usr_one', 'usr_two'] },
    })).toEqual({
      companyId: 'cmp_bert',
      audience: { type: 'USERS', userIds: ['usr_two', 'usr_one'] },
    })
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_bert',
      body: '  Важливе оновлення  ',
      audience: { type: 'USERS', userIds: ['usr_one', 'usr_one', 'usr_two'] },
      attachmentIds: ['file_one', 'file_one'],
      mentionedUserIds: [],
    })).toMatchObject({
      body: 'Важливе оновлення',
      audience: { type: 'USERS', userIds: ['usr_one', 'usr_two'] },
      attachmentIds: ['file_one'],
      requiresAcknowledgement: false,
    })
    expect(createFeedCommentSchema.parse({
      body: ' Відповідь ',
      replyToCommentId: 'cmt_parent',
    })).toMatchObject({ body: 'Відповідь', replyToCommentId: 'cmt_parent' })
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_bert',
      body: '@Марія перевір, будь ласка',
      audience: { type: 'COMPANY' },
      mentions: [{ userId: 'usr_maria', start: 0, end: 7, label: 'Марія' }],
    }).mentions).toEqual([{ userId: 'usr_maria', start: 0, end: 7, label: 'Марія' }])
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_bert',
      body: 'Raw @Марія без вибору',
      audience: { type: 'COMPANY' },
    }).mentions).toEqual([])
    expect(updateFeedPostSchema.parse({
      body: 'Сумісне редагування старим клієнтом',
      expectedVersion: 2,
    }).mentions).toBeUndefined()
    expect(() => updateFeedPostSchema.parse({
      body: '@Марія',
      expectedVersion: 2,
      mentions: [{ userId: 'usr_maria', start: 4, end: 2, label: 'Марія' }],
    })).toThrow()
    expect(feedMentionCandidatesQuerySchema.parse({
      company: 'cmp_bert',
      audienceType: 'COMPANY',
      q: 'м',
    })).toMatchObject({ q: 'м', limit: 8 })
    expect(() => feedMentionCandidatesQuerySchema.parse({
      company: 'cmp_bert',
      audienceType: 'GROUP',
    })).toThrow()
    expect(() => createFeedPostSchema.parse({
      companyId: 'cmp_bert',
      body: '',
      audience: { type: 'USERS', userIds: [] },
    })).toThrow()
    expect(() => markFeedReadSchema.parse({
      markers: [
        { companyId: 'cmp_bert', lastItemId: 'item_one' },
        { companyId: 'cmp_bert', lastItemId: 'item_two' },
      ],
    })).toThrow()
  })

  it('keeps chat creation, collaboration, lifecycle, read and mute contracts explicit', () => {
    expect(chatThreadListQuerySchema.parse({
      company: 'cmp_bert',
      unread: 'true',
      limit: '30',
    })).toEqual({
      company: 'cmp_bert',
      unread: true,
      limit: 30,
    })
    expect(() => chatThreadListQuerySchema.parse({ limit: 51 })).toThrow()
    expect(chatMessagePageQuerySchema.parse({ before: 'cursor', limit: '50' }))
      .toEqual({ before: 'cursor', limit: 50 })
    expect(() => chatMessagePageQuerySchema.parse({ before: 'a', after: 'b' })).toThrow()
    expect(chatMessageSearchQuerySchema.parse({ q: 'x' })).toMatchObject({ q: 'x', limit: 20 })
    expect(chatMessageSearchQuerySchema.parse({ q: '😀' })).toMatchObject({ q: '😀', limit: 20 })
    expect(() => chatMessageSearchQuerySchema.parse({ q: ' ' })).toThrow()
    expect(chatUserSearchQuerySchema.parse({ company: 'cmp_bert', q: 'ОЛЕНА' }))
      .toEqual({ company: 'cmp_bert', q: 'ОЛЕНА', limit: 20 })
    expect(chatThreadPageSchema.parse({
      items: [],
      counts: { all: 0, unread: 0 },
      nextCursor: null,
    })).toEqual({
      items: [],
      counts: { all: 0, unread: 0 },
      nextCursor: null,
    })
    expect(createChatThreadSchema.parse({
      companyId: 'cmp_bert',
      kind: 'DIRECT',
      participantIds: ['usr_two'],
    })).toMatchObject({ kind: 'DIRECT', participantIds: ['usr_two'] })
    expect(createChatThreadSchema.parse({
      companyId: 'cmp_bert',
      kind: 'GROUP',
      title: 'Запуск',
      participantIds: ['usr_three', 'usr_two', 'usr_two'],
    })).toMatchObject({ kind: 'GROUP', participantIds: ['usr_three', 'usr_two'] })
    expect(() => createChatThreadSchema.parse({
      companyId: 'cmp_bert',
      kind: 'GROUP',
      participantIds: ['usr_two'],
    })).toThrow()
    expect(sendChatMessageSchema.parse({
      body: '  Готово  ',
      replyToId: null,
      attachmentIds: ['file_two', 'file_one', 'file_one'],
    })).toEqual({
      body: 'Готово',
      replyToId: null,
      attachmentIds: ['file_one', 'file_two'],
      mentions: [],
    })
    expect(sendChatMessageSchema.parse({
      body: '@Олена Бондар, перевірте',
      mentions: [{ userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' }],
    }).mentions).toEqual([{ userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' }])
    expect(sendChatMessageSchema.parse({
      body: '',
      attachmentIds: ['file_one'],
    })).toEqual({
      body: '',
      attachmentIds: ['file_one'],
      mentions: [],
    })
    expect(() => sendChatMessageSchema.parse({ body: '', attachmentIds: [] })).toThrow()
    expect(chatMentionCandidatesQuerySchema.parse({ q: 'о', limit: '8' }))
      .toEqual({ q: 'о', limit: 8 })
    expect(() => sendChatMessageSchema.parse({
      body: 'Файли',
      attachmentIds: ['1', '2', '3', '4', '5', '6'],
    })).toThrow()
    expect(editChatMessageSchema.parse({ body: '  Уточнений текст  ', expectedVersion: 2 }))
      .toEqual({ body: 'Уточнений текст', expectedVersion: 2 })
    expect(deleteChatMessageSchema.parse({ expectedVersion: 3 }))
      .toEqual({ expectedVersion: 3 })
    expect(convertChatMessageToTaskSchema.parse({
      title: '  Узгодити макет  ',
      assigneeId: 'usr_two',
      deadline: '2026-07-25T12:00:00.000Z',
    })).toEqual({
      title: 'Узгодити макет',
      assigneeId: 'usr_two',
      deadline: '2026-07-25T12:00:00.000Z',
    })
    expect(convertChatMessageToEventSchema.parse({
      title: '  Демонстрація  ',
      startAt: '2026-07-25T12:00:00.000Z',
      endAt: '2026-07-25T13:00:00.000Z',
    })).toEqual({
      title: 'Демонстрація',
      startAt: '2026-07-25T12:00:00.000Z',
      endAt: '2026-07-25T13:00:00.000Z',
      sourceTimezone: 'Europe/Kyiv',
      allDay: false,
    })
    expect(() => convertChatMessageToEventSchema.parse({
      title: 'Демонстрація',
      startAt: '2026-07-25T13:00:00.000Z',
      endAt: '2026-07-25T12:00:00.000Z',
    })).toThrow()
    expect(addChatParticipantSchema.parse({
      userId: 'usr_two',
      expectedThreadVersion: 2,
    })).toEqual({
      userId: 'usr_two',
      role: 'MEMBER',
      expectedThreadVersion: 2,
    })
    expect(updateChatParticipantSchema.parse({
      role: 'OWNER',
      expectedVersion: 1,
      expectedThreadVersion: 3,
    })).toEqual({
      role: 'OWNER',
      expectedVersion: 1,
      expectedThreadVersion: 3,
    })
    expect(removeChatParticipantSchema.parse({
      expectedVersion: 2,
      expectedThreadVersion: 4,
    })).toEqual({
      expectedVersion: 2,
      expectedThreadVersion: 4,
    })
    expect(markChatReadSchema.parse({ lastReadMessageId: 'msg_1' }))
      .toEqual({ lastReadMessageId: 'msg_1' })
    expect(updateChatPreferenceSchema.parse({ notificationMode: 'NONE', expectedVersion: 2 }))
      .toEqual({ notificationMode: 'NONE', expectedVersion: 2 })
  })

  it('validates direct user notifications without accepting empty copy', () => {
    expect(sendUserNotificationSchema.parse({
      recipientId: 'usr_olena',
      title: 'Перевірка',
      body: 'Будь ласка, перегляньте оновлення.',
    })).toEqual({
      recipientId: 'usr_olena',
      title: 'Перевірка',
      body: 'Будь ласка, перегляньте оновлення.',
    })
    expect(() => sendUserNotificationSchema.parse({
      recipientId: 'usr_olena',
      title: ' ',
      body: ' ',
    })).toThrow()
  })

  it('keeps task comment mentions structured and defaults legacy comments safely', () => {
    expect(taskCommentInputSchema.parse({ body: 'Без згадок' }).mentions).toEqual([])
    expect(taskCommentInputSchema.parse({
      body: '@Олена Бондар, перевір, будь ласка.',
      mentions: [{ userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' }],
    }).mentions).toEqual([
      { userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' },
    ])
  })

  it('validates a complete task create payload and participant invariants', () => {
    expect(createTaskSchema.parse({
      title: '  Підготувати запуск  ',
      startsAt: '2026-08-01T09:00:00.000Z',
      dueAt: '2026-08-02T09:00:00.000Z',
      participants: [
        { userId: 'usr_one', role: 'RESPONSIBLE' },
        { userId: 'usr_two', role: 'WATCHER' },
      ],
      reminders: [{
        target: { type: 'PARTICIPANTS' },
        trigger: { type: 'BEFORE_DUE', offsetMinutes: 60 },
      }],
      recurrence: {
        frequency: 'WEEKLY',
        interval: 2,
        startsAt: '2026-08-01T09:00:00.000Z',
        daysOfWeek: [1, 5],
        maxOccurrences: 10,
      },
    })).toMatchObject({
      title: 'Підготувати запуск',
      priority: 'MEDIUM',
      participants: [
        { userId: 'usr_one', role: 'RESPONSIBLE' },
        { userId: 'usr_two', role: 'WATCHER' },
      ],
      checklistItems: [],
      tagIds: [],
      relations: [],
      attachmentIds: [],
    })

    expect(() => createTaskSchema.parse({
      title: 'Без відповідального',
      participants: [{ userId: 'usr_one', role: 'WATCHER' }],
    })).toThrow()

    expect(() => createTaskSchema.parse({
      title: 'Дубль ролі',
      participants: [
        { userId: 'usr_one', role: 'RESPONSIBLE' },
        { userId: 'usr_one', role: 'COLLABORATOR' },
      ],
    })).toThrow()
  })

  it('keeps task display numbers as numeric strings', () => {
    const option = {
      id: 'tsk_one',
      number: '2401',
      title: 'Task',
      status: 'NEW',
      groupId: null,
      projectId: null,
      parentTaskId: null,
    }
    expect(taskOptionSchema.parse(option).number).toBe('2401')
    expect(() => taskOptionSchema.parse({ ...option, number: 'TSK-2401' })).toThrow()
  })

  it('keeps import states explicit and production apply separate from readiness', () => {
    expect(importDatasetKindSchema.parse('DELTA')).toBe('DELTA')
    expect(importRunModeSchema.parse('DRY_RUN')).toBe('DRY_RUN')
    expect(() => importRunModeSchema.parse('RUN_NOW')).toThrow()
    expect(importReadinessViewSchema.parse({
      state: 'BLOCKED',
      productionApplyAvailable: false,
      controlPlaneVersion: 1,
      checkedAt: '2026-07-23T09:00:00.000Z',
      counters: {
        datasets: 0,
        sealedDatasets: 0,
        runs: 0,
        unresolvedBlockingIssues: 0,
        activeMappingRows: 0,
      },
      gates: [{
        id: 'D-011',
        title: 'Політика raw-даних',
        status: 'BLOCKING',
        detail: 'Потрібне затверджене рішення.',
      }],
    }).productionApplyAvailable).toBe(false)
  })

  it('accepts only the pinned v1 Bitrix snapshot contract and safe dataset paths', () => {
    expect(bitrixSnapshotManifestPayloadSchema.parse(validManifestPayload())).toMatchObject({
      sourceBuild: '20.0.1198',
      perconaVersion: '5.7.26-29-log',
      kind: 'SNAPSHOT',
    })
    expect(importDatasetRelativePathSchema.parse('canonical/tasks/chunk-000001.ndjson.zst')).toBe('canonical/tasks/chunk-000001.ndjson.zst')
    for (const unsafePath of [
      '../secret',
      '/absolute',
      'C:/snapshot/file',
      'reports\\compatibility.json',
      'reports/./compatibility.json',
      'reports/CON.json',
      'reports/trailing.',
    ]) {
      expect(() => importDatasetRelativePathSchema.parse(unsafePath)).toThrow()
    }
    expect(() => bitrixSnapshotManifestPayloadSchema.parse({
      ...validManifestPayload(),
      datasetId: 'dataset\u001b[31m',
    })).toThrow()
  })

  it('rejects incomplete delta lineage, duplicate paths and unsafe aggregate byte counts', () => {
    const delta = {
      ...validManifestPayload(),
      kind: 'DELTA',
      sequence: 1,
    }
    expect(() => bitrixSnapshotManifestPayloadSchema.parse(delta)).toThrow()

    const duplicate = validManifestPayload()
    duplicate.files.push({ ...duplicate.files[0]! })
    expect(() => bitrixSnapshotManifestPayloadSchema.parse(duplicate)).toThrow()

    const unsafeTotal = validManifestPayload()
    unsafeTotal.files = unsafeTotal.files.map((file) => ({ ...file, bytes: Number.MAX_SAFE_INTEGER }))
    expect(() => bitrixSnapshotManifestPayloadSchema.parse(unsafeTotal)).toThrow()
  })

  it('keeps exporter sealing metadata separate from generated file hashes and signature material', () => {
    const { files: _files, ...payload } = validManifestPayload()
    expect(bitrixSnapshotSealRequestSchema.parse({
      requestVersion: 1,
      payload,
      signing: {
        signerId: 'fixture-exporter',
        keyId: 'migration-key-001',
        algorithm: 'ED25519',
      },
    })).toMatchObject({
      requestVersion: 1,
      payload: { datasetId: 'dataset-001' },
      signing: { keyId: 'migration-key-001' },
    })
    expect(() => bitrixSnapshotSealRequestSchema.parse({
      requestVersion: 1,
      payload: validManifestPayload(),
      signing: {
        signerId: 'fixture-exporter',
        keyId: 'migration-key-001',
        algorithm: 'ED25519',
      },
    })).toThrow()
  })

  it('requires deterministic company mapping policy, coverage and three-role approval evidence', () => {
    expect(companyMappingArtifactSchema.parse(validCompanyMappingArtifact())).toMatchObject({
      decisionId: 'D-024',
      companyMappingVersion: 1,
      fallbackPolicy: 'AUTHORITATIVE_ONLY',
    })

    const duplicateApproval = validCompanyMappingArtifact()
    duplicateApproval.approvals[2] = { ...duplicateApproval.approvals[0]! }
    expect(() => companyMappingArtifactSchema.parse(duplicateApproval)).toThrow()

    const unstableTarget = validCompanyMappingArtifact()
    unstableTarget.roots.push({
      ...unstableTarget.roots[0]!,
      sourceOrgUnitKey: 'department-root-2',
      resolution: {
        kind: 'MAP',
        targetCompanyId: 'cmp_bert_service',
        targetCompanyCode: 'bert-ua',
      },
    })
    expect(() => companyMappingArtifactSchema.parse(unstableTarget)).toThrow()
  })
})
