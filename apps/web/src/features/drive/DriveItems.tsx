import type { DriveFileItem, DriveFolderItem, DriveSort, DriveSortDirection } from '@lankadws/contracts'
import {
  ArrowUpFromLine, ChevronDown, ChevronUp, Download, Eye, File as FileIcon, FileImage, FileText,
  Folder, History, MoreVertical, Pencil, RotateCcw, Share2, Trash2, Users,
} from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { apiUrl } from '../../shared/api/client'
import { formatDateTime, formatFileSize } from '../../shared/lib/format'
import { IconButton } from '../../shared/ui'

export const DRIVE_DRAG_TYPE = 'application/x-lankadws-drive-item'

export type DriveAction = 'open' | 'details' | 'download' | 'rename' | 'share' | 'move-root' | 'trash' | 'restore'
export type DriveTarget =
  | { kind: 'FOLDER'; folder: DriveFolderItem }
  | { kind: 'FILE'; file: DriveFileItem }

const targetId = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.id : target.file.id
const targetName = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.name : target.file.name
const targetIsOwner = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.isOwner : target.file.isOwner
const targetShared = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.sharedWithCount : target.file.sharedWithCount
const targetUpdated = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.updatedAt : target.file.updatedAt
const targetOwnerName = (target: DriveTarget) => target.kind === 'FOLDER' ? target.folder.ownerName : target.file.ownerName

function FileGlyph({ file, size = 20 }: { file: DriveFileItem; size?: number }) {
  if (file.fileType === 'IMAGE') return <FileImage size={size} aria-hidden />
  if (file.fileType === 'PDF' || file.fileType === 'DOCUMENT') return <FileText size={size} aria-hidden />
  return <FileIcon size={size} aria-hidden />
}

function ItemMenu({
  target, isTrash, canMoveToRoot, onAction,
}: {
  target: DriveTarget
  isTrash: boolean
  canMoveToRoot: boolean
  onAction: (action: DriveAction, target: DriveTarget) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
              {target.kind === 'FILE' && item('details', <History size={15} aria-hidden />, 'Деталі та версії')}
              {target.kind === 'FILE' && item('download', <Download size={15} aria-hidden />, 'Завантажити')}
              {targetIsOwner(target) && item('rename', <Pencil size={15} aria-hidden />, 'Перейменувати')}
              {item('share', <Share2 size={15} aria-hidden />, 'Доступ')}
              {canMoveToRoot && targetIsOwner(target) && item('move-root', <ArrowUpFromLine size={15} aria-hidden />, 'Перемістити в корінь')}
              {targetIsOwner(target) && item('trash', <Trash2 size={15} aria-hidden />, 'У кошик', true)}
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
}

export function DriveItems(props: ItemsProps) {
  const { folders, files, layout, isTrash, insideFolder, onOpenFolder, onPreview, onAction, onMoveInto } = props
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)

  const startDrag = (event: DragEvent, target: DriveTarget) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DRIVE_DRAG_TYPE, JSON.stringify({
      kind: target.kind,
      id: targetId(target),
      version: target.kind === 'FILE' ? target.file.version : null,
    }))
  }

  const folderDropProps = (folder: DriveFolderItem) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRIVE_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropFolderId(folder.id)
    },
    onDragLeave: () => setDropFolderId((current) => current === folder.id ? null : current),
    onDrop: (event: DragEvent) => {
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
    <ItemMenu target={target} isTrash={isTrash} canMoveToRoot={insideFolder} onAction={onAction} />
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
              draggable={folder.isOwner && !isTrash}
              onDragStart={(event) => startDrag(event, { kind: 'FOLDER', folder })}
              {...(isTrash ? {} : folderDropProps(folder))}
              onDoubleClick={() => !isTrash && onOpenFolder(folder)}
            >
              <td>
                <button type="button" className="drive-list__name" onClick={() => !isTrash && onOpenFolder(folder)}>
                  <Folder size={18} aria-hidden />
                  <span>{folder.name}</span>
                  {folder.sharedWithCount > 0 && <Users size={13} aria-hidden className="drive-item__shared" />}
                </button>
              </td>
              <td>{folder.ownerName}</td>
              <td>{formatDateTime(folder.updatedAt)}</td>
              <td>—</td>
              <td>{menuFor({ kind: 'FOLDER', folder })}</td>
            </tr>
          ))}
          {files.map((file) => (
            <tr
              key={file.id}
              draggable={file.isOwner && !isTrash}
              onDragStart={(event) => startDrag(event, { kind: 'FILE', file })}
              onDoubleClick={() => !isTrash && onPreview(file)}
            >
              <td>
                <button type="button" className="drive-list__name" onClick={() => !isTrash && onPreview(file)}>
                  <FileGlyph file={file} size={18} />
                  <span>{file.name}</span>
                  {file.sharedWithCount > 0 && <Users size={13} aria-hidden className="drive-item__shared" />}
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
    <div className="drive-grid">
      {folders.map((folder) => (
        <article
          key={folder.id}
          className={`drive-tile drive-tile--folder ${dropFolderId === folder.id ? 'is-drop-target' : ''}`}
          draggable={folder.isOwner && !isTrash}
          onDragStart={(event) => startDrag(event, { kind: 'FOLDER', folder })}
          {...(isTrash ? {} : folderDropProps(folder))}
        >
          <button type="button" className="drive-tile__open" onClick={() => !isTrash && onOpenFolder(folder)}>
            <Folder size={22} aria-hidden />
            <span className="drive-tile__name">{folder.name}</span>
          </button>
          <div className="drive-tile__meta">
            <span>{folder.childCount > 0 ? `${folder.childCount} вкладених` : 'Порожня'}</span>
            {folder.sharedWithCount > 0 && <Users size={13} aria-hidden />}
          </div>
          {menuFor({ kind: 'FOLDER', folder })}
        </article>
      ))}
      {files.map((file) => (
        <article
          key={file.id}
          className="drive-tile drive-tile--file"
          draggable={file.isOwner && !isTrash}
          onDragStart={(event) => startDrag(event, { kind: 'FILE', file })}
        >
          <button type="button" className="drive-tile__open" onClick={() => !isTrash && onPreview(file)}>
            <span className="drive-tile__thumb">
              {file.fileType === 'IMAGE'
                ? <img src={apiUrl(`/files/${encodeURIComponent(file.fileId ?? "")}/download?inline=true`)} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                : <FileGlyph file={file} size={26} />}
            </span>
            <span className="drive-tile__name">{file.name}</span>
          </button>
          <div className="drive-tile__meta">
            <span>{formatFileSize(file.sizeBytes)}</span>
            {file.sharedWithCount > 0 && <Users size={13} aria-hidden />}
          </div>
          {menuFor({ kind: 'FILE', file })}
        </article>
      ))}
    </div>
  )
}

export { targetId, targetName, targetIsOwner, targetShared, targetUpdated, targetOwnerName }
