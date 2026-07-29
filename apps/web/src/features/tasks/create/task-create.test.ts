import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearTaskDraft,
  loadTaskDraft,
  saveTaskDraft,
  taskDraftKey,
} from './draft'
import {
  mapTaskCreatePayload,
  validateTaskCreateDraft,
  type TaskCreateDraft,
} from './types'

function draft(): TaskCreateDraft {
  return {
    title: '  Запустити кампанію  ',
    description: 'Підготувати матеріали',
    groupId: '',
    projectId: 'prj_1',
    parentTaskId: '',
    reporterId: 'usr_1',
    priority: 'HIGH',
    startsAt: '2026-08-01T09:00',
    dueAt: '2026-08-01T18:00',
    estimatedMinutes: '120',
    participants: [{ userId: 'usr_1', role: 'RESPONSIBLE' }],
    checklistItems: [{
      clientId: 'check_1',
      title: '  Перевірити тексти  ',
      isCompleted: false,
    }],
    tagIds: ['tag_1'],
    relations: [{
      clientId: 'relation_1',
      targetTaskId: 'tsk_2',
      type: 'BLOCKS',
      direction: 'OUTGOING',
    }],
    reminders: [{
      clientId: 'reminder_1',
      targetType: 'PARTICIPANTS',
      userId: '',
      triggerType: 'BEFORE_DUE',
      at: '',
      offsetMinutes: '60',
    }],
    recurrence: {
      frequency: 'WEEKLY',
      interval: '1',
      startsAt: '2026-08-08T09:00',
      daysOfWeek: [1, 5],
      dayOfMonth: '',
      endsAt: '',
      maxOccurrences: '6',
    },
    attachments: [{
      id: 'file_1',
      fileName: 'brief.pdf',
      bytes: 1024,
      scanStatus: 'QUARANTINED',
      stagedAt: '2026-08-01T08:00:00.000Z',
    }],
  }
}

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('task create payload', () => {
  it('maps nested form state to the v2 contract', () => {
    const payload = mapTaskCreatePayload(draft())

    expect(payload).toMatchObject({
      title: 'Запустити кампанію',
      estimatedMinutes: 120,
      participants: [{ userId: 'usr_1', role: 'RESPONSIBLE' }],
      checklistItems: [{ clientId: 'check_1', title: 'Перевірити тексти' }],
      relations: [{
        targetTaskId: 'tsk_2',
        type: 'BLOCKS',
        direction: 'OUTGOING',
      }],
      reminders: [{
        target: { type: 'PARTICIPANTS' },
        trigger: { type: 'BEFORE_DUE', offsetMinutes: 60 },
      }],
      recurrence: {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [1, 5],
        maxOccurrences: 6,
      },
      attachmentIds: ['file_1'],
    })
    expect(payload.startsAt).toMatch(/Z$/)
  })

  it('routes the first validation error to the relevant section', () => {
    expect(validateTaskCreateDraft({
      ...draft(),
      participants: [{ userId: 'usr_1', role: 'WATCHER' }],
    })).toEqual({
      section: 'participants',
      message: 'Додайте принаймні одного відповідального.',
    })
  })
})

describe('task create local draft', () => {
  it('restores a recent draft but drops staged attachments older than 24 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'))
    const key = taskDraftKey('usr_1', '')
    saveTaskDraft(key, {
      ...draft(),
      attachments: [
        {
          ...draft().attachments[0],
          stagedAt: '2026-08-02T09:00:00.000Z',
        },
        {
          ...draft().attachments[0],
          id: 'file_expired',
          stagedAt: '2026-08-01T08:00:00.000Z',
        },
      ],
    })

    expect(loadTaskDraft(key)?.attachments.map((item) => item.id)).toEqual(['file_1'])
    clearTaskDraft(key)
    expect(loadTaskDraft(key)).toBeNull()
  })

  it('expires the whole draft after seven days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T10:00:00.000Z'))
    const key = taskDraftKey('usr_1', '')
    localStorage.setItem(key, JSON.stringify({
      savedAt: '2026-08-01T09:00:00.000Z',
      value: draft(),
    }))

    expect(loadTaskDraft(key)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })
})
