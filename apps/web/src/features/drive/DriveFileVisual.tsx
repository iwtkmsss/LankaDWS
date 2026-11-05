import { useState } from 'react'
import { apiUrl } from '../../shared/api/client'
import { FileFormatIcon } from '../../shared/files/FileFormatIcon'
import { isPreviewableImage } from '../../shared/files/filePreview'

export function DriveFileVisual({ file, size = 22, thumbnail = false }: {
  file: { name: string; fileType: string; mimeType?: string | null; fileId?: string | null; extension?: string | null }
  size?: number
  thumbnail?: boolean
}) {
  const src = file.fileId && isPreviewableImage(file.mimeType ?? null)
    ? apiUrl(`/files/${encodeURIComponent(file.fileId)}/download?inline=true`) : null
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return thumbnail && src && src !== failedSource
    ? <img className="drive-file-miniature" src={src} alt="" width={32} height={32} loading="lazy" draggable={false} onError={() => setFailedSource(src)} />
    : <FileFormatIcon mimeType={file.mimeType ?? null} fileType={file.fileType} fileName={file.name + (file.extension ?? '')} size={size} />
}
