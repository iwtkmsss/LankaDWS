import { useInfiniteQuery } from '@tanstack/react-query'
import type { DrivePickerItem } from '@lankadws/contracts'
import { ArrowLeft, ChevronRight, File as FileIcon, FileImage, FileText, Folder, Search } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { formatFileSize } from '../../shared/lib/format'
import { EmptyState, ErrorState, Modal, Skeleton } from '../../shared/ui'
import { driveDocumentAsAttachment, fetchDrivePicker, type ChatAttachmentLike } from './api'
import { DrivePickerList } from './DrivePickerList'
import './drive.css'

function Glyph({ file }: { file: DrivePickerItem }) {
  if (file.fileType === 'IMAGE') return <FileImage size={18} aria-hidden />
  if (file.fileType === 'PDF' || file.fileType === 'DOCUMENT') return <FileText size={18} aria-hidden />
  return <FileIcon size={18} aria-hidden />
}

export function DrivePicker({
  onPick,
  onClose,
}: {
  onPick: (attachment: ChatAttachmentLike) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const { debouncedValue, onCompositionStart, onCompositionEnd } = useDebouncedSearchValue(search)
  const [busyId, setBusyId] = useState<string | null>(null)
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

  const pick = (file: DrivePickerItem) => {
    setBusyId(file.id)
    setError('')
    driveDocumentAsAttachment(file.id)
      .then((attachment) => { onPick(attachment); onClose() })
      .catch(() => setError('Не вдалося прикріпити файл із Диска.'))
      .finally(() => setBusyId(null))
  }

  const files = query.data?.pages.flatMap((page) => page.items) ?? []
  const folders = query.data?.pages.flatMap((page) => page.folders) ?? []
  const isEmpty = files.length === 0 && folders.length === 0

  return (
    <Modal title="Прикріпити з Диска" size="md" onRequestClose={onClose}>
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
          {path.length > 0 && <button type="button" disabled={busyId !== null} aria-label="Назад до попередньої папки" onClick={() => { setPath((current) => current.slice(0, -1)); setError('') }}><ArrowLeft size={16} aria-hidden /></button>}
          <button type="button" disabled={busyId !== null} aria-current={path.length === 0 ? 'page' : undefined} onClick={() => { setPath([]); setError('') }}>Мій диск</button>
          {path.map((folder, index) => <span key={folder.id}>
            <ChevronRight size={14} aria-hidden />
            <button type="button" disabled={busyId !== null} aria-current={index === path.length - 1 ? 'page' : undefined} onClick={() => { setPath((current) => current.slice(0, index + 1)); setError('') }}>{folder.name}</button>
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
              if (folder) return <button type="button" tabIndex={tabIndex} disabled={busyId !== null} aria-label={`Відкрити папку ${folder.name}`} onClick={() => { setPath((current) => [...current, folder]); setError('') }}>
                <Folder size={18} aria-hidden />
                <span className="drive-picker__name">{folder.name}</span>
                <ChevronRight size={16} aria-hidden />
              </button>
              const file = files[index - folders.length]!
              return <button type="button" tabIndex={tabIndex} disabled={busyId !== null} onClick={() => pick(file)}>
                  <Glyph file={file} />
                  <span className="drive-picker__label"><span className="drive-picker__name">{file.name}</span>
                    {debouncedValue && file.folderPath && <span className="drive-picker__path" title={file.folderPath.join(' / ')}>{file.folderPath.join(' / ')}</span>}
                  </span>
                  <span className="drive-picker__meta">
                    {busyId === file.id ? 'Додаємо…' : formatFileSize(file.sizeBytes)}
                  </span>
                </button>
            }} />
        )}
      </div>
    </Modal>
  )
}
