import { useQuery } from '@tanstack/react-query'
import { Folder } from 'lucide-react'
import { personName } from '../../shared/lib/personName'
import { Button, EmptyState, ErrorState, PageDataLoader } from '../../shared/ui'
import { fetchDriveOwners } from './api'

export function DriveOwners({ search, cursor, onOpen, onPage }: {
  search: string
  cursor?: string
  onOpen: (ownerId: string) => void
  onPage: (cursor?: string) => void
}) {
  const query = useQuery({
    queryKey: ['drive', 'owners', search, cursor],
    queryFn: ({ signal }) => fetchDriveOwners(search, cursor, signal),
  })
  if (query.isPending) return <PageDataLoader />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className="drive-owner-list">
      {query.data.items.length === 0 ? <EmptyState title="Файлів користувачів не знайдено" description="Тут відображаються користувачі, які мають файли або папки на диску." /> : (
        <div className="drive-grid">
          {query.data.items.map((owner) => (
            <button key={owner.id} type="button" className="drive-owner-folder" aria-label={`Файли користувача ${personName(owner.displayName)} @${owner.username}`} onClick={() => onOpen(owner.id)}>
              <Folder size={24} aria-hidden />
              <span className="drive-owner-folder__copy">
                <strong>{personName(owner.displayName)}</strong>
                <span className="drive-owner-tag">@{owner.username}</span>
                <small>Файлів і папок: {owner.itemCount}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {(cursor || query.data.nextCursor) && (
        <div className="drive-owner-pagination">
          {cursor && <Button variant="secondary" onClick={() => onPage()}>На початок</Button>}
          {query.data.nextCursor && <Button variant="secondary" onClick={() => onPage(query.data.nextCursor!)}>Далі</Button>}
        </div>
      )}
    </div>
  )
}
