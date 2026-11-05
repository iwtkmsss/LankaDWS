import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useDocumentTitle } from './useDocumentTitle'

it('updates the unread prefix through notification arrivals, navigation and reads', () => {
  const { rerender, unmount } = renderHook(
    ({ title, unread }) => useDocumentTitle(title, unread),
    { initialProps: { title: 'Діалог', unread: 0 } },
  )
  expect(document.title).toBe('Діалог — Lanka')
  rerender({ title: 'Діалог', unread: 3 })
  expect(document.title).toBe('(3) Діалог — Lanka')
  rerender({ title: 'Жива стрічка', unread: 3 })
  expect(document.title).toBe('(3) Жива стрічка — Lanka')
  rerender({ title: 'Жива стрічка', unread: 1 })
  expect(document.title).toBe('(1) Жива стрічка — Lanka')
  rerender({ title: 'Жива стрічка', unread: 0 })
  expect(document.title).toBe('Жива стрічка — Lanka')
  unmount()
  expect(document.title).toBe('Lanka')
})
