import { useState } from 'react'
import { File, FileImage, FileText } from 'lucide-react'
import { apiUrl } from '../api/client'
import { isPreviewableImage, normalizedFileMime, officeFileFormat, textFileFormat } from './filePreview'

export function FileFormatIcon({ mimeType, size = 26, className = '' }: { mimeType: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size * 28 / 26 }
  const office = officeFileFormat(mimeType)
  if (office) {
    const name = { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' }[office]
    const color = { word: '#185abd', excel: '#107c41', powerpoint: '#d35230' }[office]
    const letter = { word: 'W', excel: 'X', powerpoint: 'P' }[office]
    return <span className={`file-format-icon file-format-icon--office ${className}`.trim()} style={style} role="img" aria-label={`Формат ${name}`}>
      <svg width="26" height="28" viewBox="0 0 26 28" fill="none" aria-hidden="true">
        <path d="M8 2h10l6 6v18H8z" fill="#fff" stroke="#94a3b8" strokeLinejoin="round" />
        <path d="M18 2v6h6" fill="#e2e8f0" stroke="#94a3b8" strokeLinejoin="round" />
        {office === 'excel' ? <path d="M15 11h7v11h-7zM15 15h7M15 18.5h7M18.5 11v11" stroke={color} strokeWidth=".8" />
          : office === 'powerpoint' ? <><path d="M18 12v5h5a5 5 0 0 0-5-5Z" fill={color} /><path d="M16 14a4 4 0 1 0 5 5h-5z" fill={color} opacity=".45" /></>
          : <path d="M15 12h7M15 15h7M15 18h7M15 21h5" stroke={color} strokeWidth="1.3" />}
        <rect x="1" y="9" width="13" height="14" rx="1" fill={color} />
        <text x="7.5" y="19.5" fill="#fff" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="10">{letter}</text>
      </svg>
    </span>
  }
  const pdf = normalizedFileMime(mimeType) === 'application/pdf'
  const label = pdf ? 'PDF' : textFileFormat(mimeType)
  const Icon = label ? FileText : isPreviewableImage(mimeType) ? FileImage : File
  return <span className={`file-format-icon${pdf ? ' file-format-icon--pdf' : ''} ${className}`.trim()} style={style}
    role="img" aria-label={label ? `Формат ${label}` : 'Файл'}>
    <Icon size={size * 22 / 26} aria-hidden />
    {label && <span aria-hidden>{label}</span>}
  </span>
}

export function FileThumbnail({ file }: { file: { id: string; fileName: string; mimeType: string | null; scanStatus: string } }) {
  const src = apiUrl(`/files/${encodeURIComponent(file.id)}/download?inline=true`)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return file.scanStatus === 'CLEAN' && isPreviewableImage(file.mimeType) && failedSource !== src
    ? <img src={src} alt={file.fileName} loading="lazy" onError={() => setFailedSource(src)} />
    : <span className="file-thumbnail__fallback"><FileFormatIcon mimeType={file.mimeType} /></span>
}
