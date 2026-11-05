import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthProvider'
import { api } from '../../shared/api/client'
import { formatDateTime } from '../../shared/lib/format'
import { FilePreviewModal } from '../../shared/files/FilePreviewModal'
import { Button, Modal, ErrorState, Skeleton } from '../../shared/ui'
import { trashDocument } from './api'

interface DocumentFile { name: string; mimeType: string; bytes: number; scanStatus: string }
interface DocumentDetail {
  id: string
  name: string
  number: string
  updatedAt: string
  fileId: string | null
  file: DocumentFile | null
  ownerId: string
  version: number
  archivedAt: string | null
}

export function DriveDetailsDrawer({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: (document: DocumentDetail) => trashDocument(document.id, document.version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drive'] })
      void queryClient.invalidateQueries({ queryKey: ['drive-document', documentId] })
      onClose()
    },
  })
  const query = useQuery({
    queryKey: ['drive-document', documentId],
    queryFn: () => api<DocumentDetail>(`/documents/${encodeURIComponent(documentId)}`),
  })

  if (query.data?.file && query.data.fileId) {
    return <FilePreviewModal
      file={{ id: query.data.fileId, fileName: query.data.name, mimeType: query.data.file.mimeType, bytes: query.data.file.bytes }}
      openInNewTab
      saveToDrive={false}
      metadata={<><span>Номер: {query.data.number}</span><span>Оновлено: {formatDateTime(query.data.updatedAt)}</span>{remove.isError && <span role="alert">Не вдалося перемістити в кошик.</span>}</>}
      footerActions={!query.data.archivedAt && (query.data.ownerId === user?.id || user?.accountType === 'ADMIN') && <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(query.data!)}><Trash2 size={17} aria-hidden />{remove.isPending ? 'Видаляємо…' : 'Видалити'}</Button>}
      onClose={onClose}
    />
  }
  return <Modal title={query.data?.name ?? 'Файл'} onRequestClose={onClose}>
    {query.isPending ? <Skeleton rows={4} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <p>Файл для перегляду недоступний.</p>}
  </Modal>
}
