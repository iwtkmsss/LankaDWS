import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Folder } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { DriveTarget } from './DriveItems'
import { fetchMoveDestinations } from './api'

export function placeMoveMenu(anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8
  const gap = 4
  const right = anchor.right + gap
  const left = anchor.left - gap - width
  const preferredLeft = right + width <= viewportWidth - margin ? right : left >= margin ? left : right
  const preferredTop = anchor.top + height <= viewportHeight - margin ? anchor.top : anchor.bottom - height
  return {
    left: Math.max(margin, Math.min(preferredLeft, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(preferredTop, viewportHeight - height - margin)),
  }
}

type Destination = { id: string; name: string; hasChildren: boolean }

export function DriveMoveMenu({ target, menuId, onMove, onDone }: {
  target: DriveTarget
  menuId: string
  onMove: (folderId: string | null) => Promise<void>
  onDone: () => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const focusOnLoad = useRef(false)
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState<Destination[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const folder = path.at(-1)
  const folderId = folder?.id
  const sourceId = target.kind === 'FILE' ? target.file.id : target.folder.id
  const sourceParentId = target.kind === 'FILE' ? target.file.folderId : target.folder.parentId
  const canMoveHere = (folderId ?? null) !== sourceParentId
  const query = useInfiniteQuery({
    queryKey: ['drive', 'move-destination', target.kind, sourceId, folderId],
    queryFn: ({ pageParam, signal }) => fetchMoveDestinations(target.kind === 'FILE' ? 'DOCUMENT' : 'FOLDER', sourceId, folderId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: open,
  })
  const folders = query.data?.pages.flatMap((page) => page.items) ?? []
  useEffect(() => {
    if (open && folders.length === 0 && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) void query.fetchNextPage()
  }, [open, folders.length, query.hasNextPage, query.isFetching, query.isFetchNextPageError, query.fetchNextPage])
  const back = () => {
    if (busy) return
    if (path.length) { focusOnLoad.current = true; setPath((current) => current.slice(0, -1)) }
    else { setOpen(false); trigger.current?.focus() }
    setError('')
  }
  const enter = (destination: Destination) => {
    focusOnLoad.current = true
    setError('')
    setPath((current) => [...current, destination])
    if (list.current) list.current.scrollTop = 0
  }
  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return
    const element = panel.current
    const anchor = trigger.current
    const place = () => {
      const bounds = element.getBoundingClientRect()
      setPosition(placeMoveMenu(anchor.getBoundingClientRect(), bounds.width, bounds.height, window.innerWidth, window.innerHeight))
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(element)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, folderId, query.data, query.isPending])
  useEffect(() => {
    if (!open || !focusOnLoad.current || query.isPending || (query.isFetching && folders.length === 0)) return
    const first = panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    if (first) first.focus()
    else panel.current?.focus()
    focusOnLoad.current = false
  }, [open, folderId, query.isPending, query.isFetching, folders.length])
  async function move() {
    setBusy(true)
    setError('')
    try { await onMove(folderId ?? null); onDone() }
    catch { setError('Не вдалося перемістити. Перевірте доступ і повторіть спробу.'); setBusy(false) }
  }
  const show = (keyboard: boolean) => { if (!open) { focusOnLoad.current = keyboard; setOpen(true); setPath([]); setError('') } }
  return <>
    <button ref={trigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open}
      onMouseEnter={() => show(false)} onClick={() => show(true)}
      onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); show(true) } }}>
      <Folder size={15} aria-hidden /><span>Перемістити</span><ChevronRight size={14} aria-hidden />
    </button>
    {open && createPortal(<div ref={panel} role="menu" tabIndex={-1}
      aria-label={folder ? 'Перемістити в ' + folder.name : 'Папки призначення'}
      data-drive-move-menu={menuId} className="drive-move-menu" style={position}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); back() }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}>
      {folder && <div className="drive-move-menu__heading">
        <button type="button" role="menuitem" className="drive-move-menu__back" aria-label="Назад до папок" disabled={busy} onClick={back}><ArrowLeft size={15} aria-hidden /></button>
        <span title={folder.name}>{folder.name}</span>
      </div>}
      <div ref={list} role="group" aria-label="Папки для перенесення" className="drive-move-menu__list" onScroll={(event) => {
        const element = event.currentTarget
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 48 && query.hasNextPage && !query.isFetching) void query.fetchNextPage()
      }}>
        {query.isPending ? <p role="status">Завантажуємо папки…</p> : query.isError && !query.data ? <button type="button" role="menuitem" onClick={() => void query.refetch()}>Повторити завантаження папок</button> : folders.map((destination) => (
          <button key={destination.id} type="button" role="menuitem" disabled={busy}
            onClick={() => enter(destination)}
            onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); enter(destination) } }}>
            <Folder size={16} aria-hidden /><span>{destination.name}</span>{destination.hasChildren && <ChevronRight size={14} aria-hidden />}
          </button>
        ))}
        {query.isSuccess && !query.isFetching && folders.length === 0 && !query.hasNextPage && !canMoveHere && <p>Немає доступних папок для перенесення</p>}
        {(query.isFetchingNextPage || (!query.isPending && query.isFetching && folders.length === 0)) && <p role="status">Завантажуємо папки…</p>}
        {query.isFetchNextPageError && <button type="button" role="menuitem" onClick={() => void query.fetchNextPage()}>Повторити завантаження папок</button>}
      </div>
      {canMoveHere && <button type="button" role="menuitem" className="drive-move-menu__confirm"
        disabled={busy || !query.data || query.isError} onClick={() => void move()}>
        {busy ? 'Переміщуємо…' : folder ? 'Перемістити сюди' : 'У корінь диска'}
      </button>}
      {error && <p role="alert">{error}</p>}
    </div>, document.body)}
  </>
}
