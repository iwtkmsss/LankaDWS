import { Heart } from 'lucide-react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactionUsersPage } from '@lankadws/contracts'
import { api } from '../api/client'
import { Button, Modal } from '../ui'
import { personName } from '../lib/personName'
import './message-like-button.css'

interface MessageLikeButtonProps {
  count: number
  liked: boolean
  onClick: () => void
  reactionsUrl: string
  className?: string
  previewPlacement?: 'bottom' | 'right'
}

export function MessageLikeButton(props: MessageLikeButtonProps) {
  return props.count > 0 ? <MessageLikeButtonContent {...props} /> : null
}

function MessageLikeButtonContent({ count, liked, onClick, reactionsUrl, className = '', previewPlacement = 'bottom' }: MessageLikeButtonProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const restoringFocus = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popupId = useId()
  const fetchPage = (limit: number, cursor?: string | null, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: String(limit) })
    if (cursor) query.set('cursor', cursor)
    return api<ReactionUsersPage>(`${reactionsUrl}?${query}`, { signal })
  }
  const preview = useQuery({
    queryKey: ['reaction-users', reactionsUrl, count, liked, 'preview'],
    queryFn: ({ signal }) => fetchPage(5, null, signal),
    enabled: previewOpen && count > 0,
    staleTime: 0,
  })
  const all = useInfiniteQuery({
    queryKey: ['reaction-users', reactionsUrl, count, liked, 'all'],
    queryFn: ({ pageParam, signal }) => fetchPage(50, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: allOpen && count > 0,
    staleTime: 0,
  })
  const keepOpen = () => clearTimeout(closeTimer.current)
  const showPreview = () => {
    keepOpen()
    if (!allOpen && !restoringFocus.current) setPreviewOpen(true)
  }
  const scheduleClose = () => {
    keepOpen()
    closeTimer.current = setTimeout(() => setPreviewOpen(false), 180)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useLayoutEffect(() => {
    if (!previewOpen) return
    const update = () => {
      if (!trigger.current || !popup.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const panel = popup.current.getBoundingClientRect()
      setPosition({
        left: Math.max(12, Math.min(previewPlacement === 'right' ? anchor.right + 8 : anchor.left, window.innerWidth - panel.width - 12)),
        top: previewPlacement === 'right'
          ? Math.max(12, Math.min(anchor.top, window.innerHeight - panel.height - 12))
          : Math.max(12, anchor.bottom + panel.height + 8 <= window.innerHeight - 12
            ? anchor.bottom + 8 : anchor.top - panel.height - 8),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [previewOpen, preview.data, preview.isError, previewPlacement])
  useEffect(() => {
    if (!previewOpen) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setPreviewOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewOpen(false)
        restoringFocus.current = true
        trigger.current?.focus()
        restoringFocus.current = false
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [previewOpen])
  const users = (items: ReactionUsersPage['items']) => (
    <ul className="message-like-users__list">
      {items.map((user) => <li key={user.id}>
        <Heart size={15} fill="currentColor" aria-hidden="true" />
        <span>{personName(user.displayName)}</span>
      </li>)}
    </ul>
  )
  if (count <= 0) return null

  return (
    <><button
      ref={trigger}
      type="button"
      className={`message-like-button${liked ? ' is-mine' : ''} ${className}`}
      aria-label={liked ? 'Прибрати вподобання' : 'Подобається'}
      aria-pressed={liked}
      aria-haspopup="dialog"
      aria-expanded={previewOpen || allOpen}
      aria-controls={previewOpen ? popupId : undefined}
      onMouseEnter={showPreview}
      onMouseLeave={scheduleClose}
      onFocus={showPreview}
      onBlur={(event) => {
        if (!popup.current?.contains(event.relatedTarget)) scheduleClose()
      }}
      onClick={onClick}
    >
      <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
      <span>·</span>
      <span>{count}</span>
    </button>
      {previewOpen && createPortal(<div
        ref={popup}
        id={popupId}
        className="message-like-users"
        role="dialog"
        aria-label="Хто вподобав"
        style={position}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        onFocus={keepOpen}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) scheduleClose()
        }}
      >
        {preview.isPending ? <p role="status">Завантаження…</p> : preview.isError ? <>
          <p role="alert">Не вдалося завантажити вподобання.</p>
          <Button variant="ghost" onClick={() => void preview.refetch()}>Повторити</Button>
        </> : <>
          {users(preview.data.items)}
          {preview.data.items.length === 0 && <p>Вподобань поки немає.</p>}
          {preview.data.nextCursor && <Button variant="ghost" onClick={() => {
            keepOpen()
            setPreviewOpen(false)
            setAllOpen(true)
          }}>Показати всіх · {preview.data.total}</Button>}
        </>}
      </div>, document.body)}
      {allOpen && <Modal title="Хто вподобав" size="sm" mobileFullscreen={false} onRequestClose={() => {
        setAllOpen(false)
        restoringFocus.current = true
        trigger.current?.focus()
        restoringFocus.current = false
      }}>
        <div className="message-like-users__scroll" role="region" aria-label="Список користувачів, які вподобали" tabIndex={0}
          onScroll={(event) => {
            const list = event.currentTarget
            if (list.scrollHeight - list.scrollTop - list.clientHeight < 80 && all.hasNextPage && !all.isFetchingNextPage && !all.isFetchNextPageError) void all.fetchNextPage()
          }}>
          {all.isPending ? <p role="status">Завантаження…</p> : all.isError && !all.data ? <p role="alert">Не вдалося завантажити вподобання.</p>
            : users(Array.from(new Map(all.data?.pages.flatMap((page) => page.items).map((user) => [user.id, user])).values()))}
          {all.isError && <Button variant="ghost" onClick={() => void (all.isFetchNextPageError ? all.fetchNextPage() : all.refetch())}>Повторити</Button>}
          {all.hasNextPage && !all.isFetchNextPageError && <Button variant="ghost" disabled={all.isFetchingNextPage} onClick={() => void all.fetchNextPage()}>
            {all.isFetchingNextPage ? 'Завантаження…' : 'Показати ще'}
          </Button>}
        </div>
      </Modal>}
    </>
  )
}
