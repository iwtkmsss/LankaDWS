import { useState } from 'react'
import { apiUrl } from '../api/client'
import { isPreviewableImage } from './filePreview'
import { FileFormatIcon } from './FileFormatIcon'

export function FileThumbnail({ file }: { file: { id: string; fileName: string; mimeType: string | null; scanStatus: string } }) {
  const src = apiUrl(`/files/${encodeURIComponent(file.id)}/download?inline=true`)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return file.scanStatus === 'CLEAN' && isPreviewableImage(file.mimeType) && failedSource !== src
    ? <img src={src} alt={file.fileName} loading="lazy" onError={() => setFailedSource(src)} />
    : <span className="file-thumbnail__fallback"><FileFormatIcon mimeType={file.mimeType} fileName={file.fileName} /></span>
}
