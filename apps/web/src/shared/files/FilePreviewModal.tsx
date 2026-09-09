import { useState } from 'react'
import { Download, FileText, ZoomIn, ZoomOut } from 'lucide-react'
import { apiUrl } from '../api/client'
import { IconButton, Modal } from '../ui'

export interface PreviewFile {
  id: string
  fileName: string
  mimeType: string | null
  bytes?: number | null
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function FilePreviewModal({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const [zoom, setZoom] = useState(100)
  const inlineUrl = apiUrl(`/files/${encodeURIComponent(file.id)}/download?inline=true`)
  const downloadUrl = apiUrl(`/files/${encodeURIComponent(file.id)}/download`)
  const isImage = file.mimeType?.startsWith('image/') ?? false
  const isPdf = file.mimeType === 'application/pdf'
  const size = formatFileSize(file.bytes)

  return (
    <Modal
      title={file.fileName}
      size="xl"
      className="file-preview-modal"
      bodyClassName="file-preview-modal__body"
      onRequestClose={onClose}
      footer={(
        <div className="file-preview-modal__footer">
          <span>{size}</span>
          <a className="button button--primary" href={downloadUrl}>
            <Download size={17} />Завантажити
          </a>
        </div>
      )}
    >
      {isImage ? (
        <div className="file-preview-modal__image-layout">
          <div className="file-preview-modal__toolbar" aria-label="Масштаб зображення">
            <IconButton
              label="Зменшити"
              disabled={zoom <= 50}
              onClick={() => setZoom((value) => Math.max(50, value - 25))}
            >
              <ZoomOut size={18} />
            </IconButton>
            <button type="button" onClick={() => setZoom(100)} aria-label="Відновити масштаб 100%">
              {zoom}%
            </button>
            <IconButton
              label="Збільшити"
              disabled={zoom >= 300}
              onClick={() => setZoom((value) => Math.min(300, value + 25))}
            >
              <ZoomIn size={18} />
            </IconButton>
          </div>
          <div className="file-preview-modal__image-stage">
            <img src={inlineUrl} alt={file.fileName} style={{ width: `${zoom}%` }} />
          </div>
        </div>
      ) : isPdf ? (
        <iframe title={`Перегляд ${file.fileName}`} src={inlineUrl} />
      ) : (
        <div className="file-preview-modal__unsupported">
          <FileText size={42} />
          <strong>Передперегляд цього формату недоступний</strong>
          <span>Файл можна завантажити та відкрити у відповідній програмі.</span>
          <a className="button button--secondary" href={downloadUrl}>
            <Download size={17} />Завантажити файл
          </a>
        </div>
      )}
    </Modal>
  )
}
