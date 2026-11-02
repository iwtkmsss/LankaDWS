import { Archive, File, FileText, Image } from 'lucide-react'
import { fileFormat } from './fileFormat'

export function FileFormatIcon({ mimeType, fileName, size = 26, className = '', fileType }: { mimeType: string | null; fileName?: string; size?: number; className?: string; fileType?: string }) {
  const style = { width: size, height: size * 28 / 26 }
  const format = fileFormat(mimeType, fileName, fileType)
  const office = format === 'word' || format === 'excel' || format === 'powerpoint' ? format : null
  const pdf = format === 'pdf'
  if (pdf) {
    return <span className={`file-format-icon file-format-icon--pdf ${className}`.trim()} style={style} role="img" aria-label="Формат PDF">
      <svg width="26" height="28" viewBox="0 0 26 28" fill="none" aria-hidden="true">
        <path d="M7 1.5h10l6.5 6.5v16.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-21a2 2 0 0 1 2-2Z" fill="#fff" stroke="#cbd5e1" />
        <path d="M17 1.5V6a2 2 0 0 0 2 2h4.5" fill="#fee2e2" stroke="#fca5a5" strokeLinejoin="round" />
        <path d="M10 14.5c2-2.5 4-7.5 2.5-8-1.5-.5-.5 5 2 7s5 1.5 4 .5-7.5-.5-9.5 1.5c-1.5 1.5-1 .5 1-1Z" stroke="#e53935" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="1" y="17" width="24" height="10" rx="2.5" fill="#b91c1c" />
        <rect x="1" y="16" width="24" height="10" rx="2.5" fill="#e53935" />
        <text x="13" y="23.5" fill="#fff" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="7.5" letterSpacing=".6">PDF</text>
      </svg>
    </span>
  }
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
  const media = format === 'image' || format === 'archive'
  const extension = fileName?.match(/\.([a-z\d]+)$/i)?.[1].toUpperCase()
  const mime = mimeType?.split(';')[0].trim().toLowerCase() ?? ''
  const mimeLabels: Record<string, string> = {
    'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WEBP',
    'image/svg+xml': 'SVG', 'image/bmp': 'BMP', 'image/avif': 'AVIF', 'image/heic': 'HEIC',
    'image/heif': 'HEIF', 'image/tiff': 'TIFF', 'image/x-icon': 'ICO', 'image/vnd.microsoft.icon': 'ICO',
    'application/zip': 'ZIP', 'application/x-zip': 'ZIP', 'application/x-zip-compressed': 'ZIP',
    'application/vnd.rar': 'RAR', 'application/x-rar': 'RAR', 'application/x-rar-compressed': 'RAR',
    'application/x-7z-compressed': '7Z', 'application/x-tar': 'TAR', 'application/tar': 'TAR',
    'application/gzip': 'GZ', 'application/x-gzip': 'GZ', 'application/x-bzip': 'BZ',
    'application/x-bzip2': 'BZ2', 'application/x-xz': 'XZ', 'application/x-compress': 'Z',
  }
  const label = media
    ? extension || mimeLabels[mime] || (format === 'image' ? 'IMG' : 'ZIP')
    : ['TXT', 'CSV', 'JSON', 'XML'].includes(format) ? format : null
  const Icon = format === 'image' ? Image : format === 'archive' ? Archive : label ? FileText : File
  return <span className={`file-format-icon file-format-icon--${media ? format : label ? 'text' : format} ${className}`.trim()} style={style}
    role="img" aria-label={media ? format === 'image' ? 'Зображення' : 'Архів' : label ? `Формат ${label}` : 'Файл'}>
    <Icon size={media || label ? size : size * 22 / 26} viewBox={media || label ? '2 1 20 22' : undefined} aria-hidden />
    {label && <span aria-hidden>{label}</span>}
  </span>
}

