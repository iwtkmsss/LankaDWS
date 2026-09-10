import { useCallback, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { UploadCloud } from 'lucide-react'

function hasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false
  return Array.from(transfer.types ?? []).includes('Files')
}

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true
  const patterns = accept.split(',').map((pattern) => pattern.trim().toLowerCase()).filter(Boolean)
  if (patterns.length === 0) return true
  const mimeType = file.type.toLowerCase()
  const fileName = file.name.toLowerCase()
  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return fileName.endsWith(pattern)
    if (pattern.endsWith('/*')) return mimeType.startsWith(pattern.slice(0, -1))
    return mimeType === pattern
  })
}

/**
 * Assigns dropped files to a native input so uncontrolled `FormData` forms keep working.
 * `DataTransfer` is unavailable in jsdom, so the assignment is best-effort.
 */
function assignFiles(input: HTMLInputElement | null, files: File[]): void {
  if (!input || typeof DataTransfer === 'undefined') return
  try {
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    input.files = transfer.files
  } catch {
    // Browser refused a synthetic FileList; the caller still receives the files.
  }
}

export interface FileDropTargetOptions {
  disabled?: boolean
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  /** Called when every dropped file was filtered out by `accept`. */
  onRejected?: () => void
}

export interface FileDropTargetProps {
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

/**
 * Drag-and-drop wiring for any surface that accepts files. Uses an enter/leave
 * counter so the active state does not flicker while dragging over children.
 */
export function useFileDropTarget({ disabled = false, onFiles, accept, multiple = true, onRejected }: FileDropTargetOptions): {
  isDragging: boolean
  dropTargetProps: FileDropTargetProps
} {
  const depth = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const stop = useCallback(() => {
    depth.current = 0
    setIsDragging(false)
  }, [])

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (disabled || !hasFiles(event.dataTransfer)) return
    event.preventDefault()
    depth.current += 1
    setIsDragging(true)
  }, [disabled])

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (disabled || !hasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (disabled || !hasFiles(event.dataTransfer)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setIsDragging(false)
  }, [disabled])

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (disabled || !hasFiles(event.dataTransfer)) return
    event.preventDefault()
    stop()
    const dropped = Array.from(event.dataTransfer.files)
    const allowed = dropped.filter((file) => matchesAccept(file, accept))
    if (allowed.length === 0) {
      if (dropped.length > 0) onRejected?.()
      return
    }
    onFiles(multiple ? allowed : allowed.slice(0, 1))
  }, [accept, disabled, multiple, onFiles, onRejected, stop])

  return { isDragging, dropTargetProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

/**
 * Overlay that marks an existing surface (a composer, a card) as a drop area
 * while a file drag is in progress.
 */
export function FileDropOverlay({ active, label = 'Відпустіть файли тут' }: { active: boolean; label?: string }) {
  if (!active) return null
  return (
    <div className="file-drop-overlay" aria-hidden="true">
      <span className="file-drop-overlay__panel">
        <UploadCloud size={22} />
        {label}
      </span>
    </div>
  )
}

export interface FileDropzoneProps {
  /** Accessible name of the underlying input. */
  label: string
  /** Form field name; keep it when the surrounding form reads files from `FormData`. */
  name?: string
  accept?: string
  multiple?: boolean
  required?: boolean
  disabled?: boolean
  busy?: boolean
  /** Main line inside the zone. */
  title?: ReactNode
  /** Secondary line: accepted formats, size or count limits. */
  hint?: ReactNode
  buttonLabel?: string
  className?: string
  /** Rendered under the zone, e.g. the list of picked files. */
  children?: ReactNode
  /** Clears the input after each selection; use it when files are uploaded immediately. */
  resetAfterSelect?: boolean
  onFiles?: (files: File[]) => void
}

/**
 * Localized file picker with drag-and-drop. The native input stays in the DOM
 * (so forms, keyboard and assistive tech keep working) but its browser-locale
 * chrome is never shown.
 */
export function FileDropzone({
  label,
  name,
  accept,
  multiple = false,
  required = false,
  disabled = false,
  busy = false,
  title = 'Перетягніть файли сюди',
  hint,
  buttonLabel = 'Вибрати з комп’ютера',
  className = '',
  children,
  resetAfterSelect = false,
  onFiles,
}: FileDropzoneProps) {
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [rejected, setRejected] = useState(false)

  const handleDropped = useCallback((files: File[]) => {
    setRejected(false)
    if (resetAfterSelect) {
      assignFiles(inputRef.current, [])
    } else {
      assignFiles(inputRef.current, files)
    }
    onFiles?.(files)
  }, [onFiles, resetAfterSelect])

  const { isDragging, dropTargetProps } = useFileDropTarget({
    disabled: disabled || busy,
    onFiles: handleDropped,
    accept,
    multiple,
    onRejected: () => setRejected(true),
  })

  return (
    <div className={`file-dropzone-field ${className}`.trim()}>
      <label
        htmlFor={inputId}
        className={`file-dropzone${isDragging ? ' is-dragging' : ''}${disabled || busy ? ' is-disabled' : ''}`}
        {...dropTargetProps}
      >
        <UploadCloud size={26} aria-hidden="true" />
        <strong className="file-dropzone__title">{isDragging ? 'Відпустіть файли тут' : title}</strong>
        {hint && <small className="file-dropzone__hint" id={hintId}>{hint}</small>}
        <span className="file-dropzone__button">{busy ? 'Завантаження…' : buttonLabel}</span>
        {rejected && (
          <small className="file-dropzone__rejected" role="alert">
            Такий формат файлу не підтримується.
          </small>
        )}
        <input
          ref={inputRef}
          id={inputId}
          className="file-dropzone__input"
          type="file"
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          name={name}
          accept={accept}
          multiple={multiple}
          required={required}
          disabled={disabled || busy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            if (resetAfterSelect) event.currentTarget.value = ''
            setRejected(false)
            if (files.length > 0) onFiles?.(files)
          }}
        />
      </label>
      {children}
    </div>
  )
}
