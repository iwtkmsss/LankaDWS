import { useInfiniteQuery } from '@tanstack/react-query'
import type { DrivePickerItem } from '@lankadws/contracts'
import { ArrowLeft, Check, ChevronRight, Folder, Search } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { formatFileSize } from '../../shared/lib/format'
import { Button, EmptyState, ErrorState, Modal, Skeleton } from '../../shared/ui'
import { driveDocumentAsAttachment, fetchDrivePicker, type ChatAttachmentLike } from './api'
import { DrivePickerList } from './DrivePickerList'
import { DriveFileVisual } from './DriveFileVisual'
import { DriveFileName } from './DriveFileName'
import './drive.css'

function Glyph({ file }: { file: DrivePickerItem }) {
  return <span className="drive-picker__file-icon" aria-hidden="true"><DriveFileVisual file={file} thumbnail /></span>
}

export function DrivePicker({
  onPick,
  onClose,
  maxSelection,
}: {
  onPick: (attachment: ChatAttachmentLike) => void | Promise<unknown>
  onClose: () => void
  maxSelection?: number
}) {
  const [search, setSearch] = useState('')
  const { debouncedValue, onCompositionStart, onCompositionEnd } = useDebouncedSearchValue(search)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [path, setPath] = useState<{ id: string; name: string }[]>([])
  const folderId = path.at(-1)?.id
  const pickerId = useId()
  const scrollPositions = useRef(new Map<string, number>())
  const locationKey = JSON.stringify([debouncedValue, debouncedValue ? null : folderId])

  const query = useInfiniteQuery({
    queryKey: ['drive', 'picker', pickerId, debouncedValue, debouncedValue ? undefined : folderId],
    queryFn: ({ pageParam, signal }) => fetchDrivePicker(debouncedValue, pageParam, signal, debouncedValue ? undefined : folderId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Keep loaded pages while browsing; each dialog instance starts a fresh cache.
    staleTime: 'static',
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setError('')
  }

  const pick = async () => {
    if (busy || selected.size === 0) return
    setBusy(true)
    setError('')
    try {
      for (const id of selected) {
        const attachment = await driveDocumentAsAttachment(id)
        await onPick(attachment)
        setSelected((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
      }
      onClose()
    } catch {
      setError('Не вдалося прикріпити всі вибрані файли. Уже додані файли знято з вибору. Спробуйте ще раз.')
    } finally {
      setBusy(false)
    }
  }

  const files = query.data?.pages.flatMap((page) => page.items) ?? []
  const folders = query.data?.pages.flatMap((page) => page.folders) ?? []
  const isEmpty = files.length === 0 && folders.length === 0

  return (
    <Modal title="Прикріпити з Диска" size="md" bodyClassName="drive-picker-modal__body" onRequestClose={() => { if (!busy) onClose() }}>
      <div className="drive-picker">
        <label className="drive-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            autoFocus
            placeholder="Пошук на диску"
            aria-label="Пошук на диску"
            value={search}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {!debouncedValue && <nav className="drive-breadcrumbs" aria-label="Шлях на диску">
          {path.length > 0 && <button type="button" className="drive-picker__back" disabled={busy} aria-label="Назад до попередньої папки" onClick={() => { setPath((current) => current.slice(0, -1)); setError('') }}><ArrowLeft size={16} aria-hidden /></button>}
          <button type="button" disabled={busy} aria-current={path.length === 0 ? 'page' : undefined} onClick={() => { setPath([]); setError('') }}>Мій диск</button>
          {path.map((folder, index) => <span key={folder.id}>
            <ChevronRight size={14} aria-hidden />
            <button type="button" disabled={busy} aria-current={index === path.length - 1 ? 'page' : undefined} onClick={() => { setPath((current) => current.slice(0, index + 1)); setError('') }}>{folder.name}</button>
          </span>)}
        </nav>}
        {error && <div className="form-error">{error}</div>}
        {query.isPending || (query.isFetching && isEmpty) ? <Skeleton rows={3} /> : query.isError && isEmpty ? <ErrorState onRetry={() => void query.refetch()} /> : isEmpty ? (
          <EmptyState
            title="Нічого не знайдено"
            description={debouncedValue ? 'Спробуйте інший запит.' : folderId ? 'Ця папка порожня.' : 'На диску ще немає файлів.'}
          />
        ) : (
          <DrivePickerList key={locationKey} count={folders.length + files.length}
            initialScrollTop={scrollPositions.current.get(locationKey) ?? 0}
            rememberScroll={(top) => { scrollPositions.current.set(locationKey, top) }}
            hasNextPage={query.hasNextPage} fetching={query.isFetchingNextPage} failed={query.isFetchNextPageError}
            loadMore={() => { if (!query.isFetching) void query.fetchNextPage() }}
            renderRow={(index, tabIndex) => {
              const folder = folders[index]
              if (folder) return <button type="button" tabIndex={tabIndex} disabled={busy} aria-label={`Відкрити папку ${folder.name}`} onClick={() => { setPath((current) => [...current, folder]); setError('') }}>
                <Folder size={18} aria-hidden />
                <span className="drive-picker__name">{folder.name}</span>
                <ChevronRight size={16} aria-hidden />
              </button>
              const file = files[index - folders.length]!
              return <button type="button" tabIndex={tabIndex} disabled={busy || (maxSelection !== undefined && selected.size >= maxSelection && !selected.has(file.id))} aria-pressed={selected.has(file.id)} onClick={() => toggle(file.id)}>
                  <span className="drive-picker__check" aria-hidden="true">{selected.has(file.id) && <Check size={14} />}</span>
                  <Glyph file={file} />
                  <span className="drive-picker__label"><DriveFileName file={file} className="drive-picker__name" />
                    {debouncedValue && file.folderPath && <span className="drive-picker__path" title={file.folderPath.join(' / ')}>{file.folderPath.join(' / ')}</span>}
                  </span>
                  <span className="drive-picker__meta">
                    {formatFileSize(file.sizeBytes)}
                  </span>
                </button>
            }} />
        )}
        <div className="drive-picker__actions">
          <span role="status">Вибрано: {selected.size}{maxSelection !== undefined ? ` із ${maxSelection}` : ''}</span>
          <Button type="button" disabled={busy || selected.size === 0} onClick={() => void pick()}>
            {busy ? 'Додаємо…' : `Прикріпити (${selected.size})`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
