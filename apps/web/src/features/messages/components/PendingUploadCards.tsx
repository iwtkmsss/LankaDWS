import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { FileFormatIcon } from '../../../shared/files/FileFormatIcon'
import { formatFileSize } from '../../../shared/lib/format'
import { CompactFileName } from '../../../shared/ui'
import { usePendingUploads, type PendingUpload } from '../lib/pendingUploads'
import './pending-upload-cards.css'

function UploadCard({ item }: { item: PendingUpload }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(item.file.type)) return
    const url = URL.createObjectURL(item.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [item.file])
  const percent = Math.min(100, Math.round(item.loaded / item.file.size * 100))
  const waiting = item.phase === 'queued' || item.phase === 'processing' || item.phase === 'sending'
  const status = item.phase === 'queued' ? 'У черзі…' : item.phase === 'processing' ? 'Обробка…' : item.phase === 'sending' ? 'Надсилання…' : `${formatFileSize(item.loaded)} / ${formatFileSize(item.file.size)}`
  return <div className={`pending-upload${preview ? ' pending-upload--photo' : ''}`}>
    <div className="pending-upload__visual">
      {preview ? <img src={preview} alt="" /> : <FileFormatIcon mimeType={item.file.type} fileName={item.file.name} size={24} />}
      <div className="pending-upload__control">
        <svg className={waiting ? 'is-spinning' : ''} viewBox="0 0 44 44" role="progressbar" aria-label={`Завантаження ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={waiting ? undefined : percent}>
          <circle className="pending-upload__track" cx="22" cy="22" r="19" />
          <circle cx="22" cy="22" r="19" pathLength="100" strokeDasharray={`${waiting ? 25 : percent} 100`} />
        </svg>
        {item.phase !== 'sending' && <button type="button" aria-label={`Скасувати надсилання ${item.file.name}`} onClick={item.cancel}><X size={16} /></button>}
      </div>
    </div>
    <div className="pending-upload__copy">
      <CompactFileName fileName={item.file.name} />
      <span title={item.phase === 'uploading' ? `Завантаження: ${percent}%` : status}>{status}</span>
    </div>
  </div>
}

export function PendingUploadCards({ threadId }: { threadId: string }) {
  const pending = usePendingUploads().filter((item) => item.threadId === threadId)
  if (!pending.length) return null
  return <div className="pending-uploads" aria-label="Файли, що надсилаються">
    {pending.map((item) => <UploadCard key={item.id} item={item} />)}
  </div>
}
