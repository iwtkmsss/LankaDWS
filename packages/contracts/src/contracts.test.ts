import { describe, expect, it } from 'vitest'
import {
  organizationCapabilityCodeSchema,
  companyScopeSchema,
  chatThreadListQuerySchema,
  chatMessagePageQuerySchema,
  chatMentionCandidatesQuerySchema,
  chatMessageSearchQuerySchema,
  chatThreadPageSchema,
  chatUserSearchQuerySchema,
  addChatParticipantSchema,
  createCalendarEventSchema,
  createChatThreadSchema,
  deleteChatMessageSchema,
  editChatMessageSchema,
  markChatReadSchema,
  removeChatParticipantSchema,
  sendChatMessageSchema,
  updateChatParticipantSchema,
  updateChatPreferenceSchema,
  createFeedCommentSchema,
  createFeedPostSchema,
  feedMentionCandidatesQuerySchema,
  feedListQuerySchema,
  updateFeedPostSchema,
  loginInputSchema,
  markFeedReadSchema,
  orgUnitListQuerySchema,
  archiveOrgUnitSchema,
  assignOrgUnitEmployeesSchema,
  createOrgUnitSchema,
  restoreOrgUnitSchema,
  updateCompanyManagerSchema,
  updateOrgUnitSchema,
  shareFileToFeedSchema,
  updateOrganizationCapabilitySchema,
  taskCommentInputSchema,
  taskOptionSchema,
  createTaskSchema,
} from './index.js'

describe('transport schemas', () => {
  it('canonicalizes a nickname and rejects email login identifiers', () => {
    expect(loginInputSchema.parse({ username: ' DMY TRO ', password: ' p a s s ' })).toMatchObject({ username: 'dmytro', password: 'pass' })
    expect(() => loginInputSchema.parse({ username: 'dmytro@example.com', password: 'x' })).toThrow()
  })

  it('accepts only explicit company scopes', () => {
    expect(companyScopeSchema.parse('all')).toBe('all')
    expect(companyScopeSchema.parse('cmp_lankadws')).toBe('cmp_lankadws')
    expect(() => companyScopeSchema.parse('everything')).toThrow()
  })

  it('keeps capability rollout explicit and company-scoped', () => {
    expect(organizationCapabilityCodeSchema.safeParse('FEED').success).toBe(false)
    expect(() => organizationCapabilityCodeSchema.parse('TASKS')).toThrow()
    expect(updateOrganizationCapabilitySchema.parse({ enabled: true, expectedVersion: 2 })).toEqual({
      enabled: true,
      expectedVersion: 2,
    })
  })

  it('normalizes bounded organization queries', () => {
    expect(orgUnitListQuerySchema.parse({ company: 'cmp_lankadws', parentId: null })).toEqual({ company: 'cmp_lankadws', parentId: null })
    expect(createOrgUnitSchema.parse({ name: '  Дослідження\tта  розвиток 🚀  ', parentId: null })).toEqual({
      name: 'Дослідження та розвиток 🚀',
      parentId: null,
    })
    expect(updateOrgUnitSchema.parse({ managerId: null, expectedVersion: 3 })).toEqual({ managerId: null, expectedVersion: 3 })
    expect(assignOrgUnitEmployeesSchema.parse({ employeeIds: ['usr_one', 'usr_two'], expectedVersion: 2 })).toEqual({ employeeIds: ['usr_one', 'usr_two'], expectedVersion: 2 })
    expect(() => assignOrgUnitEmployeesSchema.parse({ employeeIds: ['usr_one', 'usr_one'], expectedVersion: 2 })).toThrow()
    expect(archiveOrgUnitSchema.parse({ targetUnitId: 'org_target', expectedVersion: 2 })).toEqual({ targetUnitId: 'org_target', expectedVersion: 2 })
    expect(restoreOrgUnitSchema.parse({ name: '  Відновлений відділ ', parentId: null, expectedVersion: 4 })).toEqual({ name: 'Відновлений відділ', parentId: null, expectedVersion: 4 })
    expect(updateCompanyManagerSchema.parse({ managerId: null, expectedVersion: 1 })).toEqual({ managerId: null, expectedVersion: 1 })
    expect(() => createOrgUnitSchema.parse({ name: ' '.repeat(5) })).toThrow()
  })

  it('keeps feed audiences explicit and comment replies flat', () => {
    expect(feedListQuerySchema.parse({
      company: 'cmp_lankadws',
      filter: 'MINE',
      type: 'TASK',
      audienceId: 'cmp_lankadws',
      mentioned: 'true',
      important: 'false',
      limit: '10',
    })).toMatchObject({
      company: 'cmp_lankadws',
      filter: 'MINE',
      type: 'TASK',
      audienceId: 'cmp_lankadws',
      mentioned: true,
      important: false,
      limit: 10,
    })
    expect(() => feedListQuerySchema.parse({
      dateFrom: '2026-08-01',
      dateTo: '2026-07-01',
    })).toThrow()
    expect(() => feedListQuerySchema.parse({ filter: 'FOLLOWING' })).toThrow()
    expect(feedListQuerySchema.parse({ type: 'FILE' })).toMatchObject({ type: 'FILE' })
    expect(shareFileToFeedSchema.parse({
      companyId: 'cmp_lankadws',
      audience: { type: 'USERS', userIds: ['usr_two', 'usr_one', 'usr_two'] },
    })).toEqual({
      companyId: 'cmp_lankadws',
      audience: { type: 'USERS', userIds: ['usr_two', 'usr_one'] },
    })
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_lankadws',
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
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_lankadws',
      body: '',
      audience: { type: 'COMPANIES', companyIds: ['cmp_lankadws', 'cmp_other', 'cmp_other'] },
      attachmentIds: ['file_one'],
    })).toMatchObject({
      audience: { type: 'COMPANIES', companyIds: ['cmp_lankadws', 'cmp_other'] },
    })
    const placedPost = {
      companyId: 'cmp_lankadws', body: 'Фото', audience: { type: 'COMPANY' }, attachmentIds: ['file_one'],
      photoLayout: [{ fileId: 'file_one', x: 0.1, y: 0.4, width: 0.5, height: 0.3 }],
    }
    expect(createFeedPostSchema.parse(placedPost).photoLayout).toHaveLength(1)
    expect(createFeedPostSchema.parse({ ...placedPost, photoLayout: undefined }).photoLayout).toEqual([])
    expect(createFeedPostSchema.safeParse({ ...placedPost, attachmentIds: ['file_two'] }).success).toBe(false)
    expect(createFeedPostSchema.safeParse({ ...placedPost, photoLayout: [{ ...placedPost.photoLayout[0], x: 0.6 }] }).success).toBe(false)
    expect(createFeedPostSchema.safeParse({ ...placedPost, photoLayout: [placedPost.photoLayout[0], placedPost.photoLayout[0]] }).success).toBe(false)
    expect(createFeedCommentSchema.parse({
      body: ' Відповідь ',
      replyToCommentId: 'cmt_parent',
    })).toMatchObject({ body: 'Відповідь', replyToCommentId: 'cmt_parent' })
    expect(createFeedCommentSchema.parse({ body: '', attachmentIds: ['photo', 'photo'] })).toMatchObject({ body: '', attachmentIds: ['photo'] })
    expect(createFeedCommentSchema.safeParse({ body: ' ' }).success).toBe(false)
    expect(createFeedCommentSchema.safeParse({ body: '', attachmentIds: Array.from({ length: 6 }, (_, index) => `photo-${index}`) }).success).toBe(false)
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_lankadws',
      body: '@Марія перевір, будь ласка',
      audience: { type: 'COMPANY' },
      mentions: [{ userId: 'usr_maria', start: 0, end: 7, label: 'Марія' }],
    }).mentions).toEqual([{ userId: 'usr_maria', start: 0, end: 7, label: 'Марія' }])
    expect(createFeedPostSchema.parse({
      companyId: 'cmp_lankadws',
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
      company: 'cmp_lankadws',
      audienceType: 'COMPANY',
      q: 'м',
    })).toMatchObject({ q: 'м', limit: 5 })
    expect(() => feedMentionCandidatesQuerySchema.parse({
      company: 'cmp_lankadws',
      audienceType: 'GROUP',
    })).toThrow()
    expect(() => createFeedPostSchema.parse({
      companyId: 'cmp_lankadws',
      body: '',
      audience: { type: 'USERS', userIds: [] },
    })).toThrow()
    expect(() => markFeedReadSchema.parse({
      markers: [
        { companyId: 'cmp_lankadws', lastItemId: 'item_one' },
        { companyId: 'cmp_lankadws', lastItemId: 'item_two' },
      ],
    })).toThrow()
  })

  it('keeps chat creation, collaboration, lifecycle, read and mute contracts explicit', () => {
    expect(chatThreadListQuerySchema.parse({
      company: 'cmp_lankadws',
      unread: 'true',
      limit: '30',
    })).toEqual({
      company: 'cmp_lankadws',
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
    expect(chatUserSearchQuerySchema.parse({ company: 'cmp_lankadws', q: 'ОЛЕНА' }))
      .toEqual({ company: 'cmp_lankadws', q: 'ОЛЕНА', limit: 5 })
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
      companyId: 'cmp_lankadws',
      kind: 'DIRECT',
      participantIds: ['usr_two'],
    })).toMatchObject({ kind: 'DIRECT', participantIds: ['usr_two'] })
    expect(createChatThreadSchema.parse({
      companyId: 'cmp_lankadws',
      kind: 'GROUP',
      title: 'Запуск',
      participantIds: ['usr_three', 'usr_two', 'usr_two'],
    })).toMatchObject({ kind: 'GROUP', participantIds: ['usr_three', 'usr_two'] })
    expect(() => createChatThreadSchema.parse({
      companyId: 'cmp_lankadws',
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
    expect(sendChatMessageSchema.parse({
      body: 'Файли',
      attachmentIds: ['1', '2', '3', '4', '5', '6'],
    }).attachmentIds).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(editChatMessageSchema.parse({ body: '  Уточнений текст  ', expectedVersion: 2 }))
      .toEqual({ body: 'Уточнений текст', expectedVersion: 2 })
    expect(deleteChatMessageSchema.parse({ expectedVersion: 3 }))
      .toEqual({ expectedVersion: 3 })
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

  it('keeps task comment mentions structured and defaults legacy comments safely', () => {
    expect(taskCommentInputSchema.parse({ body: 'Без згадок' }).mentions).toEqual([])
    expect(taskCommentInputSchema.parse({
      body: '@Олена Бондар, перевір, будь ласка.',
      mentions: [{ userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' }],
    }).mentions).toEqual([
      { userId: 'usr_olena', start: 0, end: 13, label: 'Олена Бондар' },
    ])
  })

  it('allows task comments with only attachments but rejects completely empty comments', () => {
    expect(taskCommentInputSchema.parse({ body: '', attachmentIds: ['file_one'] })).toMatchObject({
      body: '', attachmentIds: ['file_one'], mentions: [],
    })
    expect(taskCommentInputSchema.safeParse({ body: '   ', attachmentIds: ['file_one'] }).success).toBe(true)
    expect(taskCommentInputSchema.safeParse({ body: '' }).success).toBe(false)
    expect(taskCommentInputSchema.safeParse({ body: '   ', attachmentIds: [] }).success).toBe(false)
    expect(taskCommentInputSchema.safeParse({ body: '', attachmentIds: ['', ' '] }).success).toBe(false)
    expect(taskCommentInputSchema.safeParse({ body: '', attachmentIds: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false)
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

    const placedTask = {
      title: 'З фото',
      participants: [{ userId: 'usr_one', role: 'RESPONSIBLE' }],
      attachmentIds: ['file_one'],
      photoLayout: [{ fileId: 'file_one', x: 0.1, y: 0.2, width: 0.5, height: 0.25 }],
    }
    expect(createTaskSchema.parse(placedTask).photoLayout).toHaveLength(1)
    expect(createTaskSchema.parse({ ...placedTask, photoLayout: undefined }).photoLayout).toEqual([])
    expect(createTaskSchema.safeParse({ ...placedTask, attachmentIds: ['file_two'] }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...placedTask, photoLayout: [placedTask.photoLayout[0], placedTask.photoLayout[0]] }).success).toBe(false)
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

    expect(() => createTaskSchema.parse({
      title: 'Кілька відповідальних',
      participants: [
        { userId: 'usr_one', role: 'RESPONSIBLE' },
        { userId: 'usr_two', role: 'RESPONSIBLE' },
      ],
    })).toThrow()
  })

  it('keeps task display numbers as numeric strings', () => {
    const option = {
      id: 'tsk_one',
      number: '2401',
      title: 'Task',
      status: 'NEW',
      projectId: null,
      parentTaskId: null,
    }
    expect(taskOptionSchema.parse(option).number).toBe('2401')
    expect(() => taskOptionSchema.parse({ ...option, number: 'TSK-2401' })).toThrow()
  })
})

describe('calendar event audience', () => {
  const base = {
    companyId: 'cmp_lankadws_ua',
    title: 'Зустріч команди',
    startAt: '2026-09-14T15:00:00.000Z',
    endAt: '2026-09-14T16:00:00.000Z',
    sourceTimezone: 'Europe/Kyiv',
    allDay: false,
  }

  it('keeps a private event out of every company audience', () => {
    const parsed = createCalendarEventSchema.parse({
      ...base,
      description: 'Порядок денний',
      audience: { type: 'PRIVATE' },
    })
    expect(parsed.audience).toEqual({ type: 'PRIVATE' })
    expect(parsed.description).toBe('Порядок денний')
  })

  it('deduplicates the selected companies', () => {
    const parsed = createCalendarEventSchema.parse({
      ...base,
      audience: { type: 'COMPANIES', companyIds: ['cmp_lankadws_ua', 'cmp_lankadws_ua', 'cmp_lankadws_service'] },
    })
    expect(parsed.audience).toEqual({
      type: 'COMPANIES',
      companyIds: ['cmp_lankadws_ua', 'cmp_lankadws_service'],
    })
  })

  it('allows an audience that differs from the owning company', () => {
    const parsed = createCalendarEventSchema.parse({
      ...base,
      audience: { type: 'COMPANIES', companyIds: ['cmp_lankadws_service'] },
    })
    expect(parsed.audience).toEqual({ type: 'COMPANIES', companyIds: ['cmp_lankadws_service'] })
  })

  it('still rejects an end that is not after the start', () => {
    expect(() => createCalendarEventSchema.parse({
      ...base,
      endAt: base.startAt,
      audience: { type: 'COMPANIES', companyIds: ['cmp_lankadws_ua'] },
    })).toThrow()
  })
})
