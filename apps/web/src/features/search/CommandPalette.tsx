import { CheckSquare2, Gauge, Search, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { routes } from '../../app/routes'
import { api } from '../../shared/api/client'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { DialogBase, IconButton } from '../../shared/ui'

interface PaletteItem {
  id: string
  title: string
  safeSnippet: string
  type: string
  route: string
  companyId: string | null
}

export interface PaletteShortcut {
  path: string
  title: string
  safeSnippet: string
}

const paletteTypeLabels: Record<string, string> = {
  QUICK: 'Швидкі переходи',
  TASK: 'Завдання',
  EMPLOYEE: 'Люди',
}

export function CommandPalette({ onClose, shortcuts }: {
  onClose: () => void
  shortcuts: PaletteShortcut[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PaletteItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const paletteRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const {
    debouncedValue: debouncedQuery,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query, 220)
  const hasSearchQuery = Boolean(query.trim()) && !isComposing

  useEffect(() => {
    const value = debouncedQuery.trim()
    setActiveIndex(0)
    if (!value || isComposing) {
      setResults([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    void api<{ items: PaletteItem[] }>(`/search?q=${encodeURIComponent(value)}`, {
      signal: controller.signal,
    }).then((data) => {
      if (!cancelled) setResults(data.items)
    }).catch(() => {
      if (!cancelled) setResults([])
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [debouncedQuery, isComposing])

  useEffect(() => {
    paletteRef.current?.querySelector<HTMLElement>('button.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const shortcutItems = useMemo<PaletteItem[]>(() => shortcuts.map((shortcut) => ({
    id: shortcut.path,
    title: shortcut.title,
    safeSnippet: shortcut.safeSnippet,
    type: 'QUICK',
    route: shortcut.path,
    companyId: null,
  })), [shortcuts])
  const items = hasSearchQuery ? results : shortcutItems

  function open(item: PaletteItem) {
    navigate(item.route)
    onClose()
  }

  function itemIcon(item: PaletteItem) {
    if (item.type === 'TASK') return <CheckSquare2 size={18} />
    if (item.type === 'EMPLOYEE') return <Users size={18} />
    const baseRoute = item.route.split('?')[0]
    const RouteIcon = routes.find((candidate) => candidate.path === baseRoute)?.navIcon
    return RouteIcon ? <RouteIcon size={18} /> : <Gauge size={18} />
  }

  return (
    <DialogBase
      title="Глобальний пошук"
      variant="palette"
      size="lg"
      titleVisibility="sr-only"
      showClose={false}
      initialFocusRef={searchInputRef}
      onRequestClose={onClose}
      bodyClassName="palette__body"
      headerClassName="palette__header"
      footerClassName="palette__footer"
      header={(
        <>
          <Search size={20} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && items.length) {
                event.preventDefault()
                setActiveIndex((index) => (index + 1) % items.length)
              } else if (event.key === 'ArrowUp' && items.length) {
                event.preventDefault()
                setActiveIndex((index) => (index - 1 + items.length) % items.length)
              } else if (event.key === 'Enter' && items[activeIndex]) {
                event.preventDefault()
                open(items[activeIndex])
              }
            }}
            placeholder="Завдання або люди…"
            aria-label="Знайти або перейти"
          />
          <IconButton label="Закрити пошук" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </>
      )}
      footer={(
        <>
          <span><kbd>↑</kbd><kbd>↓</kbd> вибір · <kbd>Enter</kbd> відкрити</span>
          <span><kbd>Esc</kbd> закрити</span>
        </>
      )}
    >
      <div className="palette__results" ref={paletteRef}>
        {loading ? (
          <p>Шукаємо доступні завдання та людей…</p>
        ) : items.length ? (
          <ul role="listbox" aria-label={hasSearchQuery ? 'Результати пошуку' : 'Швидкі переходи'}>
            {items.map((item, index) => {
              const previous = items[index - 1]
              return (
                <li key={`${item.type}:${item.id}`} role="presentation">
                  {(!previous || previous.type !== item.type) && (
                    <span className="palette__group">{paletteTypeLabels[item.type] ?? item.type}</span>
                  )}
                  <button
                    role="option"
                    aria-selected={activeIndex === index}
                    className={activeIndex === index ? 'is-active' : ''}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => open(item)}
                  >
                    <i>{itemIcon(item)}</i>
                    <span><strong>{item.title}</strong><small>{item.safeSnippet}</small></span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p>Нічого не знайдено</p>
        )}
      </div>
    </DialogBase>
  )
}
