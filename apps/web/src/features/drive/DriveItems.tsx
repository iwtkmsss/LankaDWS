import type { DriveFileItem, DriveFolderItem, DriveSort, DriveSortDirection } from '@lankadws/contracts'
import {
  ArrowUpFromLine, ChevronDown, ChevronUp, Download, Eye,
  Folder, MoreVertical, Pencil, RotateCcw, Share2, Trash2, Users,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { apiUrl } from '../../shared/api/client'
import { formatDateTime, formatFileSize } from '../../shared/lib/format'
import { IconButton } from '../../shared/ui'
import { FileFormatIcon } from '../../shared/files/FileThumbnail'
import { useAuth } from '../../shared/auth/AuthProvider'
import { DriveMoveMenu } from './DriveMoveMenu'

export const DRIVE_DRAG_TYPE = 'application/x-lankadws-drive-item'

export type DriveAction = 'open' | 'download' | 'rename' | 'share' | 'move' | 'move-root' | 'trash' | 'restore'
export type DriveTarget =
  | { kind: 'FOLDER'; folder: DriveFolderItem }
  | { kind: 'FILE'; file: DriveFileItem }

const targetId = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.id : target.file.id
const targetName = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.name : target.file.name
const targetIsOwner = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.isOwner : target.file.isOwner
const targetCanEdit = (target: DriveTarget) => targetIsOwner(target) || (target.kind === 'FOLDER' ? target.folder.accessRole : target.file.accessRole) === 'EDITOR'
const targetShared = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.sharedWithCount : target.file.sharedWithCount
const targetUpdated = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.updatedAt : target.file.updatedAt
const targetOwnerName = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.ownerName : target.file.ownerName

function FileGlyph({ file, size = 20 }: { file: DriveFileItem; size?: number }) {
  return <FileFormatIcon mimeType={file.mimeType} size={size} />
}

function FileName({ file }: { file: DriveFileItem }) {
  const extension = file.extension && !file.name.toLowerCase().endsWith(file.extension.toLowerCase()) ? file.extension : ''
  return (
    <span className="drive-tile__name" title={`${file.name}${extension}`}>
      {file.name}<span aria-hidden>{extension}</span>
    </span>
  )
}

function AccessIndicators({ item }: { item: DriveFileItem | DriveFolderItem }) {
  const editable = item.isOwner || item.accessRole === 'EDITOR'
  return (
    <span className="drive-item__indicators">
      <span role="img" aria-label={editable ? 'Доступно для редагування' : 'Доступно для перегляду'} title={editable ? 'Доступно для редагування' : 'Доступно для перегляду'}>
        {editable ? <Pencil size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
      </span>
      {(item.isShared || item.sharedWithCount > 0) && <span role="img" aria-label="Спільний доступ" title="Спільний доступ"><Users size={13} aria-hidden /></span>}
    </span>
  )
}

function ItemMenu({
  target, isTrash, canMoveToRoot, onAction, onMove,
}: {
  target: DriveTarget
  isTrash: boolean
  canMoveToRoot: boolean
  onAction: (action: DriveAction, target: DriveTarget) => void
  onMove: (folderId: string | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const { user } = useAuth()
  const wrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node) && !(event.target instanceof Element && event.target.closest('[data-drive-move-menu]')?.getAttribute('data-drive-move-menu') === menuId)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, menuId])

  const run = (action: DriveAction) => { setOpen(false); onAction(action, target) }
  const item = (action: DriveAction, icon: ReactNode, label: string, danger = false) => (
    <button type="button" className={danger ? 'is-danger' : ''} onClick={() => run(action)}>
      {icon}{label}
    </button>
  )

  return (
    <div className="drive-item__menu" ref={wrapper}>
      <IconButton
        label={`Дії: ${targetName(target)}`}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
      >
        <MoreVertical size={16} />
      </IconButton>
      {open && (
        <div className="drive-item__menu-body" role="menu">
          {isTrash ? (
            item('restore', <RotateCcw size={15} aria-hidden />, 'Відновити')
          ) : (
            <>
              {item('open', target.kind === 'FOLDER' ? <Folder size={15} aria-hidden /> : <Eye size={15} aria-hidden />, 'Відкрити')}
              {target.kind === 'FILE' && item('download', <Download size={15} aria-hidden />, 'Завантажити')}
              {targetCanEdit(target) && item('rename', <Pencil size={15} aria-hidden />, 'Перейменувати')}
              {item('share', <Share2 size={15} aria-hidden />, 'Доступ')}
              {targetCanEdit(target) && <DriveMoveMenu target={target} menuId={menuId} onMove={onMove} onDone={() => setOpen(false)} />}
              {canMoveToRoot && targetCanEdit(target) && item('move-root', <ArrowUpFromLine size={15} aria-hidden />, 'Перемістити в корінь')}
              {(targetIsOwner(target) || user?.accountType === 'ADMIN') && item('trash', <Trash2 size={15} aria-hidden />, 'Видалити', true)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface ItemsProps {
  folders: DriveFolderItem[]
  files: DriveFileItem[]
  layout: 'GRID' | 'LIST'
  sort: DriveSort
  direction: DriveSortDirection
  isTrash: boolean
  insideFolder: boolean
  onSort: (sort: DriveSort) => void
  onOpenFolder: (folder: DriveFolderItem) => void
  onPreview: (file: DriveFileItem) => void
  onAction: (action: DriveAction, target: DriveTarget) => void
  onMoveInto: (target: DriveTarget, folderId: string) => void
  onMove: (target: DriveTarget, folderId: string | null) => Promise<void>
}

export function DriveItems(props: ItemsProps) {
  const { folders, files, layout, isTrash, insideFolder, onOpenFolder, onPreview, onAction, onMoveInto } = props
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)

  const startDrag = (event: DragEvent, target: DriveTarget) => {
    if (isTrash || !targetCanEdit(target)) {
      event.preventDefault()
      return
    }
    // Replace native image/link drag data with the canonical Drive payload.
    event.dataTransfer.clearData()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DRIVE_DRAG_TYPE, JSON.stringify({
      kind: target.kind,
      id: targetId(target),
      version: target.kind === 'FILE' ? target.file.version : null,
    }))
  }

  const folderDropProps = (folder: DriveFolderItem) => ({
    onDragOver: (event: DragEvent) => {
      if (!targetCanEdit({ kind: 'FOLDER', folder })) return
      if (!event.dataTransfer.types.includes(DRIVE_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropFolderId(folder.id)
    },
    onDragLeave: () => setDropFolderId((current) => current === folder.id ? null : current),
    onDrop: (event: DragEvent) => {
      if (!targetCanEdit({ kind: 'FOLDER', folder })) return
      const raw = event.dataTransfer.getData(DRIVE_DRAG_TYPE)
      setDropFolderId(null)
      if (!raw) return
      event.preventDefault()
      event.stopPropagation()
      const payload = JSON.parse(raw) as { kind: 'FOLDER' | 'FILE'; id: string }
      if (payload.kind === 'FOLDER' && payload.id === folder.id) return
      const moved = payload.kind === 'FOLDER'
        ? folders.find((candidate) => candidate.id === payload.id)
        : files.find((candidate) => candidate.id === payload.id)
      if (!moved) return
      onMoveInto(
        payload.kind === 'FOLDER'
          ? { kind: 'FOLDER', folder: moved as DriveFolderItem }
          : { kind: 'FILE', file: moved as DriveFileItem },
        folder.id,
      )
    },
  })

  const menuFor = (target: DriveTarget) => (
    <ItemMenu target={target} isTrash={isTrash} canMoveToRoot={insideFolder} onAction={onAction} onMove={(destination) => props.onMove(target, destination)} />
  )

  if (layout === 'LIST') {
    const header = (key: DriveSort, label: string) => (
      <th scope="col">
        <button type="button" className="drive-list__sort" onClick={() => props.onSort(key)}>
          {label}
          {props.sort === key && (props.direction === 'ASC' ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />)}
        </button>
      </th>
    )
    return (
      <table className="responsive-table drive-list">
        <thead>
          <tr>
            {header('NAME', 'Назва')}
            {header('OWNER', 'Власник')}
            {header('MODIFIED', 'Змінено')}
            {header('SIZE', 'Розмір')}
            <th scope="col"><span className="visually-hidden">Дії</span></th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr
              key={folder.id}
              className={dropFolderId === folder.id ? 'is-drop-target' : ''}
              draggable={targetCanEdit({ kind: 'FOLDER', folder }) && !isTrash}
              onDragStart={(event) => startDrag(event, { kind: 'FOLDER', folder })}
              {...(isTrash ? {} : folderDropProps(folder))}
              onDoubleClick={() => !isTrash && onOpenFolder(folder)}
            >
              <td>
                <button type="button" className="drive-list__name" aria-label={folder.name} onClick={() => !isTrash && onOpenFolder(folder)}>
                  <Folder size={18} aria-hidden />
                  <span>{folder.name}</span>
                </button>
              </td>
              <td>{folder.ownerName}</td>
              <td>{formatDateTime(folder.updatedAt)}</td>
              <td><button type="button" className="drive-folder-size" aria-label={`Відкрити папку ${folder.name}`} disabled={isTrash} onClick={() => onOpenFolder(folder)}>{formatFileSize(folder.sizeBytes) || '—'}</button></td>
              <td>{menuFor({ kind: 'FOLDER', folder })}</td>
            </tr>
          ))}
          {files.map((file) => (
            <tr
              key={file.id}
              draggable={targetCanEdit({ kind: 'FILE', file }) && !isTrash}
              onDragStart={(event) => startDrag(event, { kind: 'FILE', file })}
              onDoubleClick={() => !isTrash && onPreview(file)}
              onContextMenu={(event) => { if (!isTrash) { event.preventDefault(); onPreview(file) } }}
            >
              <td>
                <button type="button" className="drive-list__name" aria-label={file.name} onClick={() => !isTrash && onPreview(file)}>
                  <FileGlyph file={file} size={18} />
                  <FileName file={file} />
                  <AccessIndicators item={file} />
                </button>
              </td>
              <td>{file.ownerName}</td>
              <td>{formatDateTime(file.updatedAt)}</td>
              <td>{formatFileSize(file.sizeBytes) || '—'}</td>
              <td>{menuFor({ kind: 'FILE', file })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="drive-grids">
      {folders.length > 0 && <div className="drive-grid drive-grid--folders">
        {folders.map((folder) => (
        <article
          key={folder.id}
          className={`drive-tile drive-tile--folder ${dropFolderId === folder.id ? 'is-drop-target' : ''}`}
          title={folder.childCount > 0 ? `${folder.childCount} вкладених` : 'Порожня'}
          onClick={(event) => {
            if (isTrash || (event.target as Element).closest('button, .drive-item__menu')) return
            onOpenFolder(folder)
          }}
          draggable={targetCanEdit({ kind: 'FOLDER', folder }) && !isTrash}
          onDragStart={(event) => startDrag(event, { kind: 'FOLDER', folder })}
          {...(isTrash ? {} : folderDropProps(folder))}
        >
          <div className="drive-tile__header">
            <button type="button" className="drive-tile__open" aria-label={folder.name} onClick={() => !isTrash && onOpenFolder(folder)}>
              <Folder size={22} aria-hidden />
              <span className="drive-tile__name" title={folder.name}>{folder.name}</span>
            </button>
            <button type="button" className="drive-folder-size drive-tile__folder-size" title="Відкрити папку" aria-label={`Відкрити папку ${folder.name}`} disabled={isTrash} onClick={() => onOpenFolder(folder)}>{formatFileSize(folder.sizeBytes) || '—'}</button>
            {menuFor({ kind: 'FOLDER', folder })}
          </div>
        </article>
        ))}
      </div>}
      {files.length > 0 && <div className="drive-grid drive-grid--files">
        {files.map((file) => (
        <article
          key={file.id}
          className="drive-tile drive-tile--file"
          draggable={targetCanEdit({ kind: 'FILE', file }) && !isTrash}
          onDragStart={(event) => startDrag(event, { kind: 'FILE', file })}
          onContextMenu={(event) => { if (!isTrash) { event.preventDefault(); onPreview(file) } }}
        >
          <div className="drive-tile__header">
            <button type="button" className="drive-tile__open" onClick={() => !isTrash && onPreview(file)}>
              <FileGlyph file={file} size={18} />
              <FileName file={file} />
            </button>
            {menuFor({ kind: 'FILE', file })}
          </div>
          <button type="button" className="drive-tile__open" aria-label={`Переглянути: ${file.name}`} onClick={() => !isTrash && onPreview(file)}>
            <span className="drive-tile__thumb">
              {file.fileType === 'IMAGE'
                ? <img src={apiUrl(`/files/${encodeURIComponent(file.fileId ?? "")}/download?inline=true`)} alt="" draggable={false} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                : <FileGlyph file={file} size={26} />}
            </span>
          </button>
          <div className="drive-tile__meta">
            <span>{formatFileSize(file.sizeBytes)}</span>
            <AccessIndicators item={file} />
          </div>
        </article>
        ))}
      </div>}
    </div>
  )
}

export { targetId, targetName, targetIsOwner, targetShared, targetUpdated, targetOwnerName }
