import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileArchive, FileText, ZoomIn, ZoomOut } from 'lucide-react'
import { apiUrl } from '../api/client'
import { IconButton, Modal } from '../ui'
import { SaveToDriveButton } from './SaveToDriveButton'
import { FileDocumentPreview } from './FileDocumentPreview'
import { isPreviewableImage, isTextPreview, MAX_TEXT_PREVIEW_BYTES } from './filePreview'

export interface PreviewFile {
  id: string
  fileName: string
  mimeType: string | null
  bytes?: number | null
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25
const KEY_PAN_STEP = 48
const FILE_TYPE_NAMES: Record<string, string> = {
  'application/pdf': 'PDF', 'text/plain': 'TXT', 'text/csv': 'CSV',
  'application/json': 'JSON', 'application/xml': 'XML', 'text/xml': 'XML',
  'application/msword': 'Word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/vnd.oasis.opendocument.text': 'ODT', 'application/vnd.oasis.opendocument.spreadsheet': 'ODS',
  'application/vnd.oasis.opendocument.presentation': 'ODP', 'application/rtf': 'RTF', 'text/rtf': 'RTF',
}

interface Offset {
  x: number
  y: number
}

const CENTERED: Offset = { x: 0, y: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function FilePreviewModal({ file, onClose, metadata, footerActions, openInNewTab = true, saveToDrive = true, gallery }: {
  file: PreviewFile
  onClose: () => void
  metadata?: ReactNode
  footerActions?: ReactNode
  openInNewTab?: boolean
  saveToDrive?: boolean
  gallery?: { index: number; count: number; onPrevious: () => void; onNext: () => void }
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [offset, setOffset] = useState<Offset>(CENTERED)
  const [dragging, setDragging] = useState(false)
  const [headerActionsTarget, setHeaderActionsTarget] = useState<HTMLSpanElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragOrigin = useRef<{ pointerId: number; x: number; y: number; from: Offset } | null>(null)

  const inlineUrl = apiUrl(`/files/${encodeURIComponent(file.id)}/download?inline=true`)
  const downloadUrl = apiUrl(`/files/${encodeURIComponent(file.id)}/download`)
  const mimeType = file.mimeType?.split(';')[0].trim().toLowerCase() ?? ''
  const isImage = isPreviewableImage(mimeType)
  const isPdf = mimeType === 'application/pdf'
  const isText = isTextPreview(file.mimeType)
  const textTooLarge = isText && file.bytes != null && file.bytes > MAX_TEXT_PREVIEW_BYTES
  const compact = !isImage && !isPdf && (!isText || textTooLarge)
  const isArchive = /zip|rar|tar|gzip|bzip|xz|7z/.test(mimeType)
  const fileType = FILE_TYPE_NAMES[mimeType] || file.fileName.match(/\.([a-z\d]{1,12})$/i)?.[1].toUpperCase()
    || (isArchive ? 'Архів' : isImage ? mimeType.slice(6).toUpperCase() : 'Файл')
  const size = formatFileSize(file.bytes)
  const pannable = zoom > MIN_ZOOM

  // offsetWidth is the layout (fit-to-stage) size, so it excludes the zoom transform.
  const clampOffset = useCallback((next: Offset, atZoom: number): Offset => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return next
    const slackX = Math.max(0, (image.offsetWidth * atZoom - stage.clientWidth) / 2)
    const slackY = Math.max(0, (image.offsetHeight * atZoom - stage.clientHeight) / 2)
    return { x: clamp(next.x, -slackX, slackX), y: clamp(next.y, -slackY, slackY) }
  }, [])

  const applyZoom = useCallback((nextZoomRaw: number, focus?: Offset) => {
    const nextZoom = clamp(nextZoomRaw, MIN_ZOOM, MAX_ZOOM)
    if (nextZoom === zoom) return
    const fx = focus?.x ?? 0
    const fy = focus?.y ?? 0
    setZoom(nextZoom)
    setOffset(nextZoom === MIN_ZOOM ? CENTERED : clampOffset({
      x: fx - ((fx - offset.x) / zoom) * nextZoom,
      y: fy - ((fy - offset.y) / zoom) * nextZoom,
    }, nextZoom))
  }, [clampOffset, offset.x, offset.y, zoom])

  const focusFromEvent = useCallback((clientX: number, clientY: number): Offset | undefined => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return undefined
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
  }, [])

  useEffect(() => {
    setZoom(MIN_ZOOM)
    setOffset(CENTERED)
    setDragging(false)
    dragOrigin.current = null
  }, [file.id])

  // React routes onWheel through a passive root listener, so preventDefault needs a native one.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !isImage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      applyZoom(zoom * Math.exp(-event.deltaY / 320), focusFromEvent(event.clientX, event.clientY))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [applyZoom, focusFromEvent, isImage, zoom])

  useEffect(() => {
    if (!isImage) return
    const onResize = () => setOffset((current) => clampOffset(current, zoom))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampOffset, isImage, zoom])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pannable || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragOrigin.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: offset }
    setDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) return
    setOffset(clampOffset({
      x: origin.from.x + (event.clientX - origin.x),
      y: origin.from.y + (event.clientY - origin.y),
    }, zoom))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return
    dragOrigin.current = null
    setDragging(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const pan: Record<string, Offset> = {
      ArrowUp: { x: 0, y: KEY_PAN_STEP },
      ArrowDown: { x: 0, y: -KEY_PAN_STEP },
      ArrowLeft: { x: KEY_PAN_STEP, y: 0 },
      ArrowRight: { x: -KEY_PAN_STEP, y: 0 },
    }
    const step = pan[event.key]
    if (step && pannable) {
      event.preventDefault()
      setOffset(clampOffset({ x: offset.x + step.x, y: offset.y + step.y }, zoom))
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      applyZoom(zoom + ZOOM_STEP)
    } else if (event.key === '-') {
      event.preventDefault()
      applyZoom(zoom - ZOOM_STEP)
    } else if (event.key === '0') {
      event.preventDefault()
      applyZoom(MIN_ZOOM)
    }
  }

  const stageClass = [
    'file-preview-modal__image-stage',
    pannable ? 'file-preview-modal__image-stage--pannable' : '',
    dragging ? 'file-preview-modal__image-stage--dragging' : '',
    dragging ? '' : 'file-preview-modal__image-stage--animated',
  ].filter(Boolean).join(' ')

  return (
    <Modal
      title={file.fileName}
      size={compact ? 'md' : 'xl'}
      mobileFullscreen={!compact}
      className={`file-preview-modal${compact ? ' file-preview-modal--compact' : ''}${!isImage ? ' file-preview-modal--document' : ''}`}
      bodyClassName="file-preview-modal__body"
      onRequestClose={onClose}
      headerActions={isText && !textTooLarge ? (
        <span className="file-preview-modal__header-actions" ref={setHeaderActionsTarget} />
      ) : openInNewTab && (isImage || isPdf) ? (
        <a className="icon-button file-preview-modal__open" href={inlineUrl} target="_blank" rel="noopener noreferrer" aria-label="Відкрити файл у новій вкладці" title="Відкрити файл у новій вкладці">
          <ExternalLink size={18} aria-hidden />
        </a>
      ) : undefined}
      footer={(
        <div className="file-preview-modal__footer">
          <div className="file-preview-modal__metadata"><span>{fileType}{size ? ` · ${size}` : ''}</span>{metadata}</div>
          <div className="file-preview-modal__actions">
          {footerActions}
          {saveToDrive && <SaveToDriveButton key={file.id} fileId={file.id} fileName={file.fileName} />}
          <a className="button button--primary" href={downloadUrl}>
            <Download size={17} />Завантажити
          </a>
          </div>
        </div>
      )}
    >
      {isImage ? (
        <div className="file-preview-modal__image-layout" onKeyDown={(event) => {
          if (!gallery || pannable || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            if (gallery.index > 0) gallery.onPrevious()
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            if (gallery.index < gallery.count - 1) gallery.onNext()
          }
        }}>
          <div className="file-preview-modal__toolbar" aria-label="Масштаб зображення">
            <IconButton
              label="Зменшити"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => applyZoom(zoom - ZOOM_STEP)}
            >
              <ZoomOut size={18} />
            </IconButton>
            <button type="button" onClick={() => applyZoom(MIN_ZOOM)} aria-label="Вмістити зображення у вікно">
              {Math.round(zoom * 100)}%
            </button>
            <IconButton
              label="Збільшити"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => applyZoom(zoom + ZOOM_STEP)}
            >
              <ZoomIn size={18} />
            </IconButton>
          </div>
          <div
            ref={stageRef}
            className={stageClass}
            role="group"
            aria-label="Область перегляду зображення"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
            onDoubleClick={(event) => applyZoom(pannable ? MIN_ZOOM : 2, focusFromEvent(event.clientX, event.clientY))}
          >
            <img
              ref={imageRef}
              src={inlineUrl}
              alt={file.fileName}
              draggable={false}
              style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
            />
          </div>
          {gallery && gallery.count > 1 && <>
            <IconButton className="file-preview-modal__previous" label="Попереднє фото"
              disabled={gallery.index === 0} onClick={gallery.onPrevious}>
              <ChevronLeft size={24} />
            </IconButton>
            <IconButton className="file-preview-modal__next" label="Наступне фото"
              disabled={gallery.index === gallery.count - 1} onClick={gallery.onNext}>
              <ChevronRight size={24} />
            </IconButton>
            <span className="file-preview-modal__position" role="status" aria-live="polite">
              {gallery.index + 1} / {gallery.count}
            </span>
          </>}
        </div>
      ) : isPdf || (isText && !textTooLarge) ? (
        <FileDocumentPreview key={`${file.id}:${mimeType}`} kind={isPdf ? 'pdf' : 'text'} fileName={file.fileName}
          downloadUrl={downloadUrl} headerActionsTarget={headerActionsTarget} />
      ) : (
        <div className="file-preview-modal__unsupported">
          {isArchive ? <FileArchive size={42} aria-hidden /> : <FileText size={42} aria-hidden />}
          <strong>{file.fileName}</strong>
          <span>{fileType}{size ? ` · ${size}` : ''}</span>
          <p>{textTooLarge
            ? 'Перегляд тексту доступний для файлів до 1 МБ. Завантажте файл, щоб прочитати його повністю.'
            : 'Завантажте файл, щоб відкрити його у відповідній програмі.'}</p>
        </div>
      )}
    </Modal>
  )
}
