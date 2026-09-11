import { useQuery } from '@tanstack/react-query'
import { Download, Eye, History } from 'lucide-react'
import { useState } from 'react'
import { api, apiUrl } from '../../shared/api/client'
import { formatDateTime, formatFileSize } from '../../shared/lib/format'
import { FilePreviewModal } from '../../shared/files/FilePreviewModal'
import { Button, Drawer, ErrorState, Skeleton } from '../../shared/ui'

interface VersionFile { name: string; mimeType: string; bytes: number; scanStatus: string }
interface DocumentVersion {
  id: string
  version: number
  fileId: string
  changeSummary: string
  createdAt: string
  file: VersionFile | null
}
interface DocumentDetail {
  id: string
  name: string
  number: string
  updatedAt: string
  versions: DocumentVersion[]
}

export function DriveDetailsDrawer({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['drive-document', documentId],
    queryFn: () => api<DocumentDetail>(`/documents/${encodeURIComponent(documentId)}`),
  })

  const versions = query.data?.versions ?? []
  const current = versions[0]
  const previewVersion = versions.find((version) => version.id === previewVersionId)

  return (
    <>
      <Drawer title={query.data?.name ?? 'Файл'} onRequestClose={onClose}>
        {query.isPending ? <Skeleton rows={4} /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data ? (
          <div className="drive-details">
            <dl className="drive-details__meta">
              <div><dt>Номер</dt><dd>{query.data.number}</dd></div>
              <div><dt>Оновлено</dt><dd>{formatDateTime(query.data.updatedAt)}</dd></div>
              <div><dt>Розмір</dt><dd>{formatFileSize(current?.file?.bytes) || '—'}</dd></div>
              <div><dt>Версій</dt><dd>{versions.length}</dd></div>
            </dl>

            {current?.file && (
              <div className="drive-details__actions">
                <Button variant="secondary" onClick={() => setPreviewVersionId(current.id)}>
                  <Eye size={16} aria-hidden />Переглянути
                </Button>
                <a className="button button--secondary" href={apiUrl(`/files/${encodeURIComponent(current.fileId)}/download`)}>
                  <Download size={16} aria-hidden />Завантажити
                </a>
              </div>
            )}

            <section className="drive-details__versions">
              <h3><History size={16} aria-hidden />Історія версій</h3>
              <ul>
                {versions.map((version) => (
                  <li key={version.id}>
                    <div>
                      <strong>Версія {version.version}</strong>
                      <span>{version.changeSummary}</span>
                      <time dateTime={version.createdAt}>{formatDateTime(version.createdAt)}</time>
                    </div>
                    {version.file && (
                      <button type="button" onClick={() => setPreviewVersionId(version.id)}>
                        Переглянути версію {version.version}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </Drawer>
      {previewVersion?.file && (
        <FilePreviewModal
          file={{
            id: previewVersion.fileId,
            fileName: previewVersion.file.name,
            mimeType: previewVersion.file.mimeType,
            bytes: previewVersion.file.bytes,
          }}
          onClose={() => setPreviewVersionId(null)}
        />
      )}
    </>
  )
}
