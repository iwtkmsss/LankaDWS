import { useQuery } from '@tanstack/react-query'
import type { DriveFileItem } from '@lankadws/contracts'
import { File as FileIcon, FileImage, FileText, Search } from 'lucide-react'
import { useState } from 'react'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { formatFileSize } from '../../shared/lib/format'
import { EmptyState, Modal, Skeleton } from '../../shared/ui'
import { driveDocumentAsAttachment, fetchDrive, type ChatAttachmentLike } from './api'
import './drive.css'

function Glyph({ file }: { file: DriveFileItem }) {
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

  const query = useQuery({
    queryKey: ['drive-picker', debouncedValue],
    queryFn: () => fetchDrive({
      view: debouncedValue ? 'MY_DRIVE' : 'RECENT',
      ...(debouncedValue ? { search: debouncedValue } : {}),
    }),
  })

  const pick = (file: DriveFileItem) => {
    setBusyId(file.id)
    setError('')
    driveDocumentAsAttachment(file.id)
      .then((attachment) => { onPick(attachment); onClose() })
      .catch(() => setError('Не вдалося прикріпити файл із Диска.'))
      .finally(() => setBusyId(null))
  }

  const files = query.data?.files ?? []

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
        {error && <div className="form-error">{error}</div>}
        {query.isPending ? <Skeleton rows={3} /> : files.length === 0 ? (
          <EmptyState
            title="Нічого не знайдено"
            description={debouncedValue ? 'Спробуйте інший запит.' : 'На диску ще немає файлів.'}
          />
        ) : (
          <ul className="drive-picker__list">
            {files.map((file) => (
              <li key={file.id}>
                <button type="button" disabled={busyId !== null} onClick={() => pick(file)}>
                  <Glyph file={file} />
                  <span className="drive-picker__name">{file.name}</span>
                  <span className="drive-picker__meta">
                    {busyId === file.id ? 'Додаємо…' : formatFileSize(file.sizeBytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
