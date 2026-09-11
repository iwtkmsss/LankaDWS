import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DriveFileItem, DriveModifiedFilter, DriveFileType, DrivePeopleFilter,
  DriveSort, DriveSortDirection, DriveView,
} from '@lankadws/contracts'
import {
  Clock, FolderPlus, Grid2x2, HardDrive, List, Plus, Search, Trash2, Upload, Users, X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, apiUrl } from '../../shared/api/client'
import { useAuth } from '../../shared/auth/AuthProvider'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { FileDropOverlay, useFileDropTarget } from '../../shared/files/FileDropzone'
import { FilePreviewModal } from '../../shared/files/FilePreviewModal'
import { Button, EmptyState, ErrorState, PageDataLoader, PageHeader } from '../../shared/ui'
import {
  createFolder, fetchDrive, moveDocument, moveFolder, renameDocument, renameFolder,
  restoreDocument, restoreFolder, trashDocument, trashFolder, uploadToDrive,
} from './api'
import { DriveItems, type DriveAction, type DriveTarget } from './DriveItems'
import { DriveDetailsDrawer } from './DriveDetailsDrawer'
import { NameDialog, ShareDialog } from './DriveDialogs'
import './drive.css'

const VIEWS: Array<{ id: DriveView; label: string; icon: typeof HardDrive }> = [
  { id: 'MY_DRIVE', label: 'Мій диск', icon: HardDrive },
  { id: 'SHARED', label: 'Спільні зі мною', icon: Users },
  { id: 'RECENT', label: 'Нещодавні', icon: Clock },
  { id: 'TRASH', label: 'Кошик', icon: Trash2 },
]

const TYPES: Array<{ value: DriveFileType; label: string }> = [
  { value: 'ALL', label: 'Тип' },
  { value: 'FOLDER', label: 'Папки' },
  { value: 'DOCUMENT', label: 'Документи' },
  { value: 'IMAGE', label: 'Зображення' },
  { value: 'PDF', label: 'PDF' },
  { value: 'OTHER', label: 'Інше' },
]
const PEOPLE: Array<{ value: DrivePeopleFilter; label: string }> = [
  { value: 'ANYONE', label: 'Люди' },
  { value: 'ME', label: 'Мої' },
  { value: 'OTHERS', label: 'Інших людей' },
]
const MODIFIED: Array<{ value: DriveModifiedFilter; label: string }> = [
  { value: 'ANY', label: 'Змінено' },
  { value: 'TODAY', label: 'Сьогодні' },
  { value: 'WEEK', label: 'За тиждень' },
  { value: 'MONTH', label: 'За місяць' },
  { value: 'YEAR', label: 'За рік' },
]

interface CompanyOption {
  id: string
  name: string
}

function FilterChip<T extends string>({
  options, value, onChange, label,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  const isDefault = value === options[0]!.value
  const current = options.find((option) => option.value === value) ?? options[0]!
  return (
    <span className={`drive-chip ${isDefault ? '' : 'is-active'}`}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span aria-hidden className="drive-chip__text">{current.label}</span>
      {!isDefault && (
        <button type="button" aria-label={`Скинути фільтр «${label}»`} onClick={() => onChange(options[0]!.value)}>
          <X size={13} />
        </button>
      )}
    </span>
  )
}

export default function DrivePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { documentId } = useParams()
  const [params, setParams] = useSearchParams()
  const [layout, setLayout] = useState<'GRID' | 'LIST'>(
    () => (localStorage.getItem('drive:layout') as 'GRID' | 'LIST' | null) ?? 'GRID',
  )
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const { debouncedValue, onCompositionStart, onCompositionEnd } = useDebouncedSearchValue(searchInput)
  const [preview, setPreview] = useState<DriveFileItem | null>(null)
  const [shareTarget, setShareTarget] = useState<DriveTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<DriveTarget | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [banner, setBanner] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)

  const view = (params.get('view') ?? 'MY_DRIVE') as DriveView
  const folderId = params.get('folder') ?? undefined
  const type = (params.get('type') ?? 'ALL') as DriveFileType
  const people = (params.get('people') ?? 'ANYONE') as DrivePeopleFilter
  const modified = (params.get('modified') ?? 'ANY') as DriveModifiedFilter
  const sort = (params.get('sort') ?? 'MODIFIED') as DriveSort
  const direction = (params.get('dir') ?? 'DESC') as DriveSortDirection
  const isGlobalAdmin = user?.accountType === 'ADMIN'
  const companyId = isGlobalAdmin ? params.get('companyId') ?? undefined : user?.company?.id
  const companies = useQuery({
    queryKey: ['drive-company-options'],
    queryFn: () => api<{ items: CompanyOption[] }>('/companies'),
    enabled: isGlobalAdmin,
  })

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }

  const queryInput = {
    view, folderId, type, people, modified, sort, direction,
    ...(companyId ? { company: companyId } : {}),
    ...(debouncedValue ? { search: debouncedValue } : {}),
  }
  const query = useQuery({
    queryKey: ['drive', queryInput],
    queryFn: () => fetchDrive(queryInput),
  })

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['drive'] }) }
  const fail = (message: string) => () => setBanner(message)

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      setUploading(true)
      for (const file of files) await uploadToDrive(file, companyId, folderId ?? null)
    },
    onSuccess: () => { setBanner(''); refresh() },
    onError: fail('Не вдалося завантажити файл. Перевірте формат і розмір.'),
    onSettled: () => setUploading(false),
  })
  const move = useMutation({
    mutationFn: async ({ target, destination }: { target: DriveTarget; destination: string | null }) => {
      if (target.kind === 'FOLDER') await moveFolder(target.folder.id, destination)
      else await moveDocument(target.file.id, destination, target.file.version)
    },
    onSuccess: () => { setBanner(''); refresh() },
    onError: fail('Не вдалося перемістити. Можливо, бракує прав.'),
  })
  const rename = useMutation({
    mutationFn: async ({ target, name }: { target: DriveTarget; name: string }) => {
      if (target.kind === 'FOLDER') await renameFolder(target.folder.id, name)
      else await renameDocument(target.file.id, name, target.file.version)
    },
    onSuccess: () => { setBanner(''); refresh() },
  })
  const trash = useMutation({
    mutationFn: async (target: DriveTarget) => {
      if (target.kind === 'FOLDER') await trashFolder(target.folder.id)
      else await trashDocument(target.file.id, target.file.version)
    },
    onSuccess: () => { setBanner(''); refresh() },
    onError: fail('Не вдалося перемістити в кошик.'),
  })
  const restore = useMutation({
    mutationFn: async (target: DriveTarget) => {
      if (target.kind === 'FOLDER') await restoreFolder(target.folder.id)
      else await restoreDocument(target.file.id, target.file.version)
    },
    onSuccess: () => { setBanner(''); refresh() },
    onError: fail('Не вдалося відновити.'),
  })
  const newFolder = useMutation({
    mutationFn: async (name: string) => { await createFolder({ name, parentId: folderId ?? null, companyId }) },
    onSuccess: () => { setBanner(''); refresh() },
  })

  const dropTarget = useFileDropTarget({
    disabled: uploading || view === 'TRASH' || !companyId,
    onFiles: (files) => upload.mutate(files),
  })

  const handleAction = (action: DriveAction, target: DriveTarget) => {
    if (action === 'open') {
      if (target.kind === 'FOLDER') update({ folder: target.folder.id, view: 'MY_DRIVE' })
      else setPreview(target.file)
      return
    }
    if (action === 'download' && target.kind === 'FILE' && target.file.fileId) {
      window.location.href = apiUrl(`/files/${encodeURIComponent(target.file.fileId)}/download`)
      return
    }
    if (action === 'details' && target.kind === 'FILE') navigate(`/drive/${target.file.id}${location.search}`)
    if (action === 'rename') setRenameTarget(target)
    if (action === 'share') setShareTarget(target)
    if (action === 'move-root') move.mutate({ target, destination: null })
    if (action === 'trash') trash.mutate(target)
    if (action === 'restore') restore.mutate(target)
  }

  const breadcrumbs = query.data?.breadcrumbs ?? []
  const counts = query.data?.counts
  const isTrash = view === 'TRASH'
  const emptyCopy = useMemo(() => {
    if (debouncedValue) return { title: 'Нічого не знайдено', description: 'Спробуйте інші слова або скиньте фільтри.' }
    if (isTrash) return { title: 'Кошик порожній', description: 'Видалені файли й папки зʼявляться тут.' }
    if (view === 'SHARED') return { title: 'Немає спільних файлів', description: 'Тут зʼявиться те, чим з вами поділились.' }
    if (view === 'RECENT') return { title: 'Немає нещодавніх файлів', description: 'Відкрийте або завантажте файл.' }
    return { title: 'Тут поки порожньо', description: 'Перетягніть файли сюди або створіть папку.' }
  }, [debouncedValue, isTrash, view])

  return (
    <div
      className={`drive-page ${dropTarget.isDragging ? 'is-file-drop-target' : ''}`}
      {...dropTarget.dropTargetProps}
    >
      <PageHeader
        title="Диск"
        action={(
          <div className="drive-create">
            {isGlobalAdmin && (
              <label className="drive-company-select">
                <span className="sr-only">Компанія</span>
                <select
                  aria-label="Компанія"
                  value={companyId ?? ''}
                  disabled={companies.isPending || companies.isError}
                  onChange={(event) => update({ companyId: event.target.value || undefined, folder: undefined })}
                >
                  <option value="">Оберіть компанію</option>
                  {companies.data?.items.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>
            )}
            <Button onClick={() => fileInput.current?.click()} disabled={uploading || !companyId}>
              <Plus size={17} aria-hidden />{uploading ? 'Завантажуємо…' : 'Завантажити'}
            </Button>
            <Button variant="secondary" onClick={() => setCreatingFolder(true)} disabled={!companyId}>
              <FolderPlus size={17} aria-hidden />Нова папка
            </Button>
          </div>
        )}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) upload.mutate(files)
        }}
      />

      <div className="drive-layout">
        <nav className="drive-views" aria-label="Розділи диска">
          {VIEWS.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                className={view === entry.id ? 'is-active' : ''}
                aria-current={view === entry.id ? 'page' : undefined}
                onClick={() => update({ view: entry.id === 'MY_DRIVE' ? undefined : entry.id, folder: undefined })}
              >
                <Icon size={17} aria-hidden />
                <span>{entry.label}</span>
                {counts && counts[entry.id] > 0 && <em>{counts[entry.id]}</em>}
              </button>
            )
          })}
        </nav>

        <section className="drive-main">
          <div className="drive-toolbar">
            <label className="drive-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                placeholder="Пошук на диску"
                aria-label="Пошук на диску"
                value={searchInput}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
                onChange={(event) => { setSearchInput(event.target.value); update({ q: event.target.value || undefined }) }}
              />
            </label>
            <FilterChip label="Тип" options={TYPES} value={type} onChange={(value) => update({ type: value === 'ALL' ? undefined : value })} />
            <FilterChip label="Люди" options={PEOPLE} value={people} onChange={(value) => update({ people: value === 'ANYONE' ? undefined : value })} />
            <FilterChip label="Змінено" options={MODIFIED} value={modified} onChange={(value) => update({ modified: value === 'ANY' ? undefined : value })} />
            <div className="drive-layout-toggle" role="group" aria-label="Вигляд">
              <button
                type="button" aria-pressed={layout === 'GRID'} aria-label="Сітка"
                className={layout === 'GRID' ? 'is-active' : ''}
                onClick={() => { setLayout('GRID'); localStorage.setItem('drive:layout', 'GRID') }}
              ><Grid2x2 size={16} /></button>
              <button
                type="button" aria-pressed={layout === 'LIST'} aria-label="Список"
                className={layout === 'LIST' ? 'is-active' : ''}
                onClick={() => { setLayout('LIST'); localStorage.setItem('drive:layout', 'LIST') }}
              ><List size={16} /></button>
            </div>
          </div>

          {view === 'MY_DRIVE' && (
            <nav className="drive-breadcrumbs" aria-label="Шлях">
              <button type="button" onClick={() => update({ folder: undefined })}>Мій диск</button>
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.id}>
                  <span aria-hidden>/</span>
                  <button
                    type="button"
                    aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                    onClick={() => update({ folder: crumb.id })}
                  >{crumb.name}</button>
                </span>
              ))}
            </nav>
          )}

          {banner && <div className="form-error drive-banner" role="alert">{banner}</div>}

          {query.isPending ? <PageDataLoader /> : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : (query.data && query.data.folders.length + query.data.files.length === 0) ? (
            <EmptyState
              title={emptyCopy.title}
              description={emptyCopy.description}
              action={!isTrash && !debouncedValue && (
                <Button onClick={() => fileInput.current?.click()} disabled={!companyId}>
                  <Upload size={17} aria-hidden />Завантажити файл
                </Button>
              )}
            />
          ) : query.data ? (
            <DriveItems
              folders={query.data.folders}
              files={query.data.files}
              layout={layout}
              sort={sort}
              direction={direction}
              isTrash={isTrash}
              insideFolder={Boolean(folderId)}
              onSort={(next) => update({
                sort: next === 'MODIFIED' ? undefined : next,
                dir: sort === next && direction === 'DESC' ? 'ASC' : undefined,
              })}
              onOpenFolder={(folder) => update({ folder: folder.id, view: undefined })}
              onPreview={(file) => setPreview(file)}
              onAction={handleAction}
              onMoveInto={(target, destination) => move.mutate({ target, destination })}
            />
          ) : null}
        </section>
      </div>

      <FileDropOverlay active={dropTarget.isDragging} label="Відпустіть, щоб завантажити на Диск" />

      {preview && preview.fileId && (
        <FilePreviewModal
          file={{ id: preview.fileId, fileName: preview.name, mimeType: preview.mimeType, bytes: preview.sizeBytes }}
          onClose={() => setPreview(null)}
        />
      )}
      {documentId && (
        <DriveDetailsDrawer documentId={documentId} onClose={() => navigate(`/drive${location.search}`)} />
      )}
      {creatingFolder && (
        <NameDialog
          title="Нова папка"
          label="Назва папки"
          confirmLabel="Створити"
          onSubmit={(name) => newFolder.mutateAsync(name).then(() => undefined)}
          onClose={() => setCreatingFolder(false)}
        />
      )}
      {renameTarget && (
        <NameDialog
          title="Перейменувати"
          label="Нова назва"
          initialValue={renameTarget.kind === 'FOLDER' ? renameTarget.folder.name : renameTarget.file.name}
          confirmLabel="Зберегти"
          onSubmit={(name) => rename.mutateAsync({ target: renameTarget, name }).then(() => undefined)}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {shareTarget && (
        <ShareDialog
          targetType={shareTarget.kind === 'FOLDER' ? 'FOLDER' : 'DOCUMENT'}
          targetId={shareTarget.kind === 'FOLDER' ? shareTarget.folder.id : shareTarget.file.id}
          targetName={shareTarget.kind === 'FOLDER' ? shareTarget.folder.name : shareTarget.file.name}
          canManage={shareTarget.kind === 'FOLDER' ? shareTarget.folder.isOwner : shareTarget.file.isOwner}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  )
}
