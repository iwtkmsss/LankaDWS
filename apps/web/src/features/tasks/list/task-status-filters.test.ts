import { describe, expect, it } from 'vitest'
import { readTaskStatusFilter, TASK_STATUS_OPTIONS, writeTaskStatusFilter } from './task-status-filters'

describe('task status filter URL state', () => {
  it('round-trips multiple actual statuses and preserves unrelated filters', () => {
    const params = new URLSearchParams('page=3&role=CREATOR&search=test')
    writeTaskStatusFilter(params, 'ALL', ['NEW', 'IN_PROGRESS'])
    expect(params.get('status')).toBe('NEW,IN_PROGRESS')
    expect(params.has('page')).toBe(false)
    expect(params.get('role')).toBe('CREATOR')
    expect(params.get('search')).toBe('test')
    expect(readTaskStatusFilter(params).selected).toEqual(['NEW', 'IN_PROGRESS'])
  })
  it('round-trips mixed deadlines/statuses, all and empty selections', () => {
    const params = new URLSearchParams()
    writeTaskStatusFilter(params, 'ALL', ['OVERDUE', 'IN_PROGRESS', 'DONE'])
    expect(readTaskStatusFilter(params).selected).toEqual(['OVERDUE', 'IN_PROGRESS', 'DONE'])
    writeTaskStatusFilter(params, 'ALL', TASK_STATUS_OPTIONS.map((option) => option.value))
    expect(params.get('preset')).toBe('ALL')
    expect(readTaskStatusFilter(params).selected).toHaveLength(TASK_STATUS_OPTIONS.length)
    writeTaskStatusFilter(params, 'ALL', [])
    expect(params.get('preset')).toBe('NONE')
    expect(readTaskStatusFilter(params).selected).toEqual([])
  })
  it('restores saved legacy active selections as concrete statuses', () => {
    expect(readTaskStatusFilter(new URLSearchParams('preset=OTHER_ACTIVE')).selected).toEqual(['IN_PROGRESS', 'IN_REVIEW'])
    expect(readTaskStatusFilter(new URLSearchParams('statusGroup=DONE&preset=ALL')).selected).toEqual(['DONE'])
  })
})
