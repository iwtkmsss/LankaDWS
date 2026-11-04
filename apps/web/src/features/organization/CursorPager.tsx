import { useState } from 'react'
import { Button } from '../../shared/ui'

/** Local back stack for cursor-paged lists. Changing `scope` returns to the first page. */
export function useCursorPages(scope: string) {
  const [pages, setPages] = useState({ scope, cursors: [] as string[] })
  const cursors = pages.scope === scope ? pages.cursors : []
  return {
    cursor: cursors.at(-1),
    hasPrevious: cursors.length > 0,
    previous: () => setPages({ scope, cursors: cursors.slice(0, -1) }),
    next: (cursor: string) => setPages({ scope, cursors: [...cursors, cursor] }),
  }
}

/** Uses aria-disabled so keyboard focus stays on the button while the next page loads. */
export function CursorPager({ label, hasPrevious, nextCursor, onPrevious, onNext }: {
  label: string
  hasPrevious: boolean
  nextCursor?: string | null
  onPrevious: () => void
  onNext: (cursor: string) => void
}) {
  if (!hasPrevious && !nextCursor) return null
  return <nav className="cursor-pager" aria-label={label}>
    <Button type="button" variant="secondary" aria-disabled={!hasPrevious} onClick={() => { if (hasPrevious) onPrevious() }}>Назад</Button>
    <Button type="button" variant="secondary" aria-disabled={!nextCursor} onClick={() => { if (nextCursor) onNext(nextCursor) }}>Далі</Button>
  </nav>
}
