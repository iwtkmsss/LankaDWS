import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setMessageDraft, sortThreadsWithDrafts, useMessageDrafts } from './messageDrafts'

describe('message drafts', () => {
  it('keeps pins above newer messages and drafts, and restores activity order after unpinning', () => {
    const threads = [
      { id: 'recent', lastMessageAt: new Date(3_000).toISOString() },
      { id: 'old', lastMessageAt: new Date(1_000).toISOString(), pinned: true },
    ]
    const drafts = { recent: { body: 'Текст', createdAt: 5_000, mentions: [] } }
    expect(sortThreadsWithDrafts(threads, drafts).map((item) => item.id)).toEqual(['old', 'recent'])
    threads[1]!.pinned = false
    expect(sortThreadsWithDrafts(threads, drafts).map((item) => item.id)).toEqual(['recent', 'old'])
  })
  beforeEach(() => window.sessionStorage.clear())

  it('bumps once per nonempty draft and lets newer messages overtake it', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { result } = renderHook(() => useMessageDrafts('me'))
    const threads = [
      { id: 'recent', lastMessageAt: new Date(1_500).toISOString() },
      { id: 'older', lastMessageAt: new Date(1_000).toISOString() },
    ]
    act(() => setMessageDraft('me', 'older', 'Перша чернетка'))
    expect(sortThreadsWithDrafts(threads, result.current).map((item) => item.id)).toEqual(['older', 'recent'])
    now.mockReturnValue(4_000)
    act(() => setMessageDraft('me', 'older', 'Редагована чернетка'))
    expect(result.current.older?.createdAt).toBe(2_000)
    threads[0]!.lastMessageAt = new Date(3_000).toISOString()
    expect(sortThreadsWithDrafts(threads, result.current).map((item) => item.id)).toEqual(['recent', 'older'])
    act(() => setMessageDraft('me', 'older', ''))
    expect(result.current.older).toBeUndefined()
    act(() => setMessageDraft('me', 'older', 'Нова чернетка'))
    expect(result.current.older?.createdAt).toBe(4_000)
    now.mockRestore()
  })

  it('keeps both chat surfaces synchronized and restores text and mentions after remount', () => {
    const first = renderHook(() => useMessageDrafts('me'))
    const second = renderHook(() => useMessageDrafts('me'))
    const mentions = [{ userId: 'person', start: 0, end: 6, label: 'Олена' }]
    act(() => setMessageDraft('me', 'thread', '@Олена привіт', mentions))
    expect(second.result.current.thread).toEqual(first.result.current.thread)
    first.unmount()
    const restored = renderHook(() => useMessageDrafts('me'))
    expect(restored.result.current.thread?.mentions).toEqual(mentions)
    expect(restored.result.current.thread?.body).toBe('@Олена привіт')
    act(() => setMessageDraft('me', 'thread', ''))
    expect(second.result.current.thread).toBeUndefined()
  })

  it('keeps spaces editable without bumping a chat and isolates accounts', () => {
    const mine = renderHook(() => useMessageDrafts('me'))
    const other = renderHook(() => useMessageDrafts('other'))
    act(() => setMessageDraft('me', 'thread', '   '))
    expect(mine.result.current.thread?.body).toBe('   ')
    expect(mine.result.current.thread?.createdAt).toBe(0)
    expect(other.result.current).toEqual({})
    act(() => setMessageDraft('me', 'thread', '   текст'))
    expect(mine.result.current.thread!.createdAt).toBeGreaterThan(0)
    act(() => setMessageDraft('me', 'thread', ' '))
    expect(mine.result.current.thread?.createdAt).toBe(0)
  })

  it('ignores malformed stored data', () => {
    window.sessionStorage.setItem('lankadws:message-drafts:me', '{invalid')
    const { result } = renderHook(() => useMessageDrafts('me'))
    expect(result.current).toEqual({})
  })
})
