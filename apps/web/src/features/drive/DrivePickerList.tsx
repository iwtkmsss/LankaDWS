import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const ROW_HEIGHT = 52
const OVERSCAN = 4

export function DrivePickerList({ count, initialScrollTop, rememberScroll, renderRow, hasNextPage, fetching, failed, loadMore }: {
  count: number
  initialScrollTop: number
  rememberScroll: (top: number) => void
  renderRow: (index: number, tabIndex: number) => ReactNode
  hasNextPage: boolean
  fetching: boolean
  failed: boolean
  loadMore: () => void
}) {
  const list = useRef<HTMLUListElement>(null)
  const pendingFocus = useRef<number | null>(null)
  const [initialOffset] = useState(initialScrollTop)
  const [scrollTop, setScrollTop] = useState(initialScrollTop)
  const [viewport, setViewport] = useState(420)
  const [activeIndex, setActiveIndex] = useState(Math.min(count - 1, Math.floor(initialScrollTop / ROW_HEIGHT)))
  const start = Math.max(0, Math.min(count - 1, Math.floor(scrollTop / ROW_HEIGHT)) - OVERSCAN)
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const footer = fetching || failed

  useLayoutEffect(() => {
    const element = list.current!
    element.scrollTop = initialOffset
    const resize = () => setViewport(element.clientHeight || 420)
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [initialOffset])

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    list.current?.querySelector<HTMLButtonElement>(`[data-row="${pendingFocus.current}"] button`)?.focus({ preventScroll: true })
    pendingFocus.current = null
  }, [activeIndex, start, end])

  return <ul ref={list} className="drive-picker__list drive-picker__list--virtual" aria-label="Файли та папки"
    style={{ height: `min(${(count + Number(footer)) * ROW_HEIGHT}px, 52vh, 420px)` }}
    onScroll={(event) => {
      const element = event.currentTarget
      setScrollTop(element.scrollTop)
      rememberScroll(element.scrollTop)
      if (element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 2 && hasNextPage && !fetching && !failed) loadMore()
    }}
    onKeyDown={(event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')
      if (!row || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = Number(row.dataset.row)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : Math.max(0, Math.min(count - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      const element = list.current!
      if (next * ROW_HEIGHT < element.scrollTop) element.scrollTop = next * ROW_HEIGHT
      else if ((next + 1) * ROW_HEIGHT > element.scrollTop + viewport) element.scrollTop = (next + 1) * ROW_HEIGHT - viewport
      rememberScroll(element.scrollTop)
      setScrollTop(element.scrollTop)
      pendingFocus.current = next
      setActiveIndex(next)
    }}>
    {start > 0 && <li aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />}
    {Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
      const index = start + offset
      return <li key={index} data-row={index} aria-posinset={index + 1} aria-setsize={count} className="drive-picker__row" onFocus={() => setActiveIndex(index)}>
        {renderRow(index, index === Math.max(start, Math.min(end - 1, activeIndex)) ? 0 : -1)}
      </li>
    })}
    {end < count && <li aria-hidden="true" style={{ height: (count - end) * ROW_HEIGHT }} />}
    {fetching && <li className="drive-picker__row" role="status">Завантажуємо файли…</li>}
    {failed && <li className="drive-picker__row"><button type="button" onClick={loadMore}>Повторити завантаження файлів</button></li>}
  </ul>
}
