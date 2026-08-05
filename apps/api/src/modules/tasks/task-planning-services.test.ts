import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import {
  nextRecurrenceOccurrence,
  recurrenceJobRunAt,
  recurrenceRelationForOccurrence,
  type RecurrenceRule,
} from './task-recurrence.service.js'
import { resolveReminderAt, writeTaskReminders } from './task-reminder.service.js'
import { TaskTimeService } from './task-time.service.js'

const timePrincipal = {
  userId: 'usr_1',
  workspaceId: 'wrk_1',
  primaryCompanyId: 'cmp_1',
  allowedCompanyIds: ['cmp_1'],
  username: 'planner',
  displayName: 'Planner',
  accountType: 'USER',
  authorizationVersion: 1,
  sessionId: 'ses_1',
  authAssurance: 1,
  restricted: false,
} as AuthPrincipal

describe('task recurrence calendar', () => {
  it('preserves local wall time across a daylight-saving transition', () => {
    const rule: RecurrenceRule = {
      frequency: 'DAILY',
      interval: 1,
      startsAt: new Date('2026-03-28T07:00:00.000Z'),
      daysOfWeek: [],
      dayOfMonth: null,
      endsAt: null,
      maxOccurrences: null,
      timezone: 'Europe/Kyiv',
    }

    expect(nextRecurrenceOccurrence(
      rule,
      new Date('2026-03-28T07:00:00.000Z'),
    )?.toISOString()).toBe('2026-03-29T06:00:00.000Z')
  })

  it('constrains month-end recurrences and respects an end date', () => {
    const rule: RecurrenceRule = {
      frequency: 'MONTHLY',
      interval: 1,
      startsAt: new Date('2026-01-31T07:00:00.000Z'),
      daysOfWeek: [],
      dayOfMonth: 31,
      endsAt: new Date('2026-02-28T07:00:00.000Z'),
      maxOccurrences: null,
      timezone: 'Europe/Kyiv',
    }

    expect(nextRecurrenceOccurrence(
      rule,
      new Date('2026-01-31T07:00:00.000Z'),
    )?.toISOString()).toBe('2026-02-28T07:00:00.000Z')
    expect(nextRecurrenceOccurrence(
      rule,
      new Date('2026-02-28T07:00:00.000Z'),
    )).toBeNull()
  })

  it('schedules occurrence generation early enough for relative reminders', () => {
    expect(recurrenceJobRunAt(
      new Date('2026-08-02T09:00:00.000Z'),
      120,
      new Date('2026-08-01T09:00:00.000Z'),
    ).toISOString()).toBe('2026-08-02T07:00:00.000Z')
  })

  it('preserves directed blocking relations when copying an occurrence', () => {
    expect(recurrenceRelationForOccurrence('tsk_template', 'tsk_occurrence', {
      sourceTaskId: 'tsk_template',
      targetTaskId: 'tsk_blocked',
      type: 'BLOCKS',
    })).toEqual({
      sourceTaskId: 'tsk_occurrence',
      targetTaskId: 'tsk_blocked',
      type: 'BLOCKS',
    })
    expect(recurrenceRelationForOccurrence('tsk_template', 'tsk_occurrence', {
      sourceTaskId: 'tsk_blocker',
      targetTaskId: 'tsk_template',
      type: 'BLOCKS',
    })).toEqual({
      sourceTaskId: 'tsk_blocker',
      targetTaskId: 'tsk_occurrence',
      type: 'BLOCKS',
    })
  })
})

describe('task reminders', () => {
  it('resolves relative reminders from task dates', () => {
    expect(resolveReminderAt({
      target: { type: 'PARTICIPANTS' },
      trigger: { type: 'BEFORE_DUE', offsetMinutes: 30 },
    }, {
      startsAt: null,
      dueAt: new Date('2026-08-02T09:00:00.000Z'),
    }).toISOString()).toBe('2026-08-02T08:30:00.000Z')
  })

  it('expands a participant reminder and schedules one deduplicated job per user', async () => {
    const tx = {
      taskReminder: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      backgroundJob: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    }

    const rows = await writeTaskReminders(
      tx as never,
      'tsk_1',
      {
        startsAt: new Date('2026-08-02T09:00:00.000Z'),
        dueAt: null,
      },
      ['usr_1', 'usr_1', 'usr_2'],
      [{
        target: { type: 'PARTICIPANTS' },
        trigger: { type: 'BEFORE_START', offsetMinutes: 60 },
      }],
      new Date('2026-08-01T09:00:00.000Z'),
    )

    expect(rows.map((row) => row.userId)).toEqual(['usr_1', 'usr_2'])
    expect(tx.taskReminder.createMany).toHaveBeenCalledOnce()
    expect(tx.backgroundJob.createMany).toHaveBeenCalledOnce()
  })
})

describe('task time tracking', () => {
  it('rejects a second active timer for the same user', async () => {
    const prisma = {
      timeEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: 'time_1', taskId: 'tsk_other' }),
      },
    }
    const access = {
      readableTask: vi.fn().mockResolvedValue({ companyId: 'cmp_1' }),
    }
    const service = new TaskTimeService(prisma as never, access as never)

    await expect(service.start(timePrincipal, 'tsk_1'))
      .rejects.toMatchObject({ safeDetail: 'task_timer_active' })
  })

  it('stops the active timer with a deterministic elapsed duration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T09:15:00.000Z'))
    const active = {
      id: 'time_1',
      taskId: 'tsk_1',
      userId: 'usr_1',
      startedAt: new Date('2026-08-01T09:00:00.000Z'),
      endedAt: null,
      durationSeconds: null,
      description: null,
      updatedAt: new Date('2026-08-01T09:00:00.000Z'),
    }
    const prisma = {
      timeEntry: {
        findFirst: vi.fn().mockResolvedValue(active),
        update: vi.fn().mockResolvedValue({
          ...active,
          endedAt: new Date('2026-08-01T09:15:00.000Z'),
          durationSeconds: 900,
          updatedAt: new Date(),
        }),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    const access = {
      readableTask: vi.fn().mockResolvedValue({ companyId: 'cmp_1' }),
    }
    const service = new TaskTimeService(prisma as never, access as never)

    const result = await service.stop(timePrincipal, 'tsk_1')

    expect(result.durationSeconds).toBe(900)
    expect(prisma.auditEvent.create).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
