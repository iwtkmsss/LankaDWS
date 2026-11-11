import { queryOptions, useQueries, useQuery } from '@tanstack/react-query'
import type { TaskAttachmentView } from '@lankadws/contracts'
import { Download, Eye } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../shared/api/client'
import { FilePreviewModal } from '../../../shared/files/FilePreviewModal'
import { FileThumbnail } from '../../../shared/files/FileThumbnail'
import { isPreviewableImage } from '../../../shared/files/filePreview'
import { FileFormatIcon } from '../../../shared/files/FileFormatIcon'
import { SaveToDriveButton } from '../../../shared/files/SaveToDriveButton'

function TaskAttachmentGlyph({ attachment }: { attachment: TaskAttachmentView }) {
  return <FileFormatIcon mimeType={attachment.mimeType} fileName={attachment.fileName} size={18} className="task-attachment-glyph" />
}

function taskFileStatusOptions(attachment: TaskAttachmentView) {
  return queryOptions({
    queryKey: ['file-status', attachment.id],
    queryFn: () => api<{ scanStatus: TaskAttachmentView['scanStatus'] }>(`/files/${attachment.id}/status`),
    enabled: !['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(attachment.scanStatus),
    staleTime: 0,
    refetchInterval: (result) => {
      const current = result.state.data?.scanStatus ?? attachment.scanStatus
      return ['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(current) ? false : 2_000
    },
  })
}

function resolvedTaskFileStatus(attachment: TaskAttachmentView, polled?: TaskAttachmentView['scanStatus']) {
  // A refreshed task may already have a terminal verdict while the disabled
  // status query still holds an older SCANNING response.
  return ['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(attachment.scanStatus)
    ? attachment.scanStatus : polled ?? attachment.scanStatus
}

export function TaskAttachment({
  attachment,
  compact = false,
  composer = false,
  actions = false,
}: {
  attachment: TaskAttachmentView
  compact?: boolean
  composer?: boolean
  actions?: boolean
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const status = useQuery(taskFileStatusOptions(attachment))
  const scanStatus = resolvedTaskFileStatus(attachment, status.data?.scanStatus)
  const imagePreview = compact && scanStatus === 'CLEAN' && isPreviewableImage(attachment.mimeType)
  const extensionIndex = attachment.fileName.lastIndexOf('.')
  const className = composer
    ? 'task-comment-composer__attachment-name'
    : compact ? `task-attachment is-compact${imagePreview ? ' task-comment-image' : ''}` : 'task-attachment'
  const content = composer ? (
    <>
      <FileFormatIcon mimeType={attachment.mimeType} fileName={attachment.fileName} size={15} />
      <span>{attachment.fileName}</span>
    </>
  ) : (
    <>
      {imagePreview ? <FileThumbnail file={{ ...attachment, scanStatus }} /> : <TaskAttachmentGlyph attachment={attachment} />}
      <span>
        <strong title={attachment.fileName}>
          <span className="task-attachment__stem">{extensionIndex > 0 ? attachment.fileName.slice(0, extensionIndex) : attachment.fileName}</span>
          {extensionIndex > 0 && <span>{attachment.fileName.slice(extensionIndex)}</span>}
        </strong>
        <small>
          {scanStatus === 'CLEAN'
            ? formatBytes(attachment.bytes)
            : taskAttachmentStateLabel(scanStatus)}
        </small>
      </span>
      {scanStatus === 'CLEAN' && <Eye size={15} />}
    </>
  )
  if (scanStatus === 'CLEAN') {
    return (
      <>
        <button
          type="button"
          className={className}
          aria-label={`Переглянути ${attachment.fileName}`}
          onClick={() => setPreviewOpen(true)}
        >
          {content}
        </button>
        {actions && <>
          <a className="task-attachment-action" href={`/api/v1/files/${encodeURIComponent(attachment.id)}/download`}
            download={attachment.fileName} title="Завантажити" aria-label={`Завантажити ${attachment.fileName}`}>
            <Download size={15} aria-hidden="true" />
          </a>
          <SaveToDriveButton fileId={attachment.id} fileName={attachment.fileName}
            className="task-attachment-action" iconOnly />
        </>}
        {previewOpen && <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />}
      </>
    )
  }
  return (
    <span className={className}>
      {content}
    </span>
  )
}

export function TaskInlinePhoto({ attachment }: { attachment: TaskAttachmentView }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const status = useQuery(taskFileStatusOptions(attachment))
  const scanStatus = status.data?.scanStatus ?? attachment.scanStatus
  return <>
    <button type="button" aria-label={`Переглянути ${attachment.fileName}`} disabled={scanStatus !== 'CLEAN'} onClick={() => setPreviewOpen(true)}><FileThumbnail file={{ ...attachment, scanStatus }} /></button>
    {previewOpen && <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />}
  </>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function taskAttachmentStateLabel(status: TaskAttachmentView['scanStatus']): string {
  if (status === 'QUARANTINED' || status === 'SCANNING') return 'Перевіряється'
  if (status === 'INFECTED') return 'Заблоковано перевіркою'
  if (status === 'UNSUPPORTED') return 'Формат не підтримується'
  if (status === 'FAILED') return 'Не вдалося перевірити файл'
  return 'Файл недоступний'
}

export function TaskFilesArchive({ attachments }: { attachments: TaskAttachmentView[] }) {
  const statuses = useQueries({ queries: attachments.map(taskFileStatusOptions) })
  if (attachments.length < 2) return null
  const current = attachments.map((file, index) => resolvedTaskFileStatus(file, statuses[index]?.data?.scanStatus))
  const ready = current.every((status) => status === 'CLEAN')
  return ready ? (
    <a className="task-files-archive" href={`/api/v1/files/archive?ids=${encodeURIComponent(attachments.map((file) => file.id).join(','))}`}>
      <Download size={14} aria-hidden="true" />
      <span>Завантажити все одним архівом</span>
    </a>
  ) : <span className="task-files-archive muted">{current.some((status) => ['INFECTED', 'UNSUPPORTED', 'FAILED'].includes(status))
    ? 'Архів недоступний: не всі файли пройшли перевірку'
    : 'Архів буде доступний після перевірки всіх файлів'}</span>
}
