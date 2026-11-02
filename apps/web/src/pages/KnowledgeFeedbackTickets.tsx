import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { FormattedText } from '../shared/text/FormattedText'
import { Button, ConfirmationDialog, ErrorState, Modal, PageDataLoader } from '../shared/ui'

interface Ticket { id: string; title: string; author: string; createdAt: string }
interface Attachment { id: string; safeFilename: string; bytes: number; mimeType: string | null; scanStatus: string }
interface TicketDetail extends Ticket { body: string; attachments: Attachment[] }
interface TicketPage { items: Ticket[]; nextCursor: string | null }

export function KnowledgeFeedbackTickets({ renderAttachment }: { renderAttachment: (attachment: Attachment) => ReactNode }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Ticket | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['feedback-tickets', user?.id],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<TicketPage>(`/knowledge/tickets${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const detail = useQuery({ queryKey: ['feedback-ticket', user?.id, selected], queryFn: () => api<TicketDetail>(`/knowledge/tickets/${selected}`), enabled: Boolean(selected) })
  const remove = useMutation({
    mutationFn: (ticket: Ticket) => api(`/knowledge/tickets/${ticket.id}`, { method: 'DELETE' }),
    onSuccess: async (_, ticket) => {
      setDeleting(null)
      if (selected === ticket.id) setSelected(null)
      client.removeQueries({ queryKey: ['feedback-ticket', user?.id, ticket.id] })
      await client.invalidateQueries({ queryKey: ['feedback-tickets'] })
    },
  })
  return <section className="knowledge-tickets" aria-label="Звернення до адміністратора">
    <header><div><h2><MessageCircle size={20} />Звернення до адміністратора</h2><p>Ці записи бачать лише адміністратори.</p></div></header>
    {query.isPending ? <PageDataLoader /> : query.isError ? <ErrorState /> : <>
      {query.data.pages.flatMap((page) => page.items).map((ticket) => <div className="knowledge-ticket-row" key={ticket.id}>
        <button type="button" className="knowledge-ticket-open" onClick={() => setSelected(ticket.id)}><strong>{ticket.title}</strong><small>{ticket.author} · {formatDateTime(ticket.createdAt)}</small></button>
        <Button variant="ghost" aria-label={`Видалити звернення ${ticket.title}`} onClick={() => { remove.reset(); setDeleting(ticket) }}><Trash2 size={17} /></Button>
      </div>)}
      {!query.data.pages[0].items.length && <p className="knowledge-empty">Нових звернень поки немає.</p>}
      {query.hasNextPage && <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Завантажуємо…' : 'Показати ще'}</Button>}
    </>}
    {selected && <Modal title="Звернення до адміністратора" size="lg" onRequestClose={() => setSelected(null)}>
      {detail.isPending ? <PageDataLoader /> : detail.isError ? <ErrorState /> : <div className="knowledge-ticket-detail">
        <h3>{detail.data.title}</h3><p className="knowledge-ticket-meta">{detail.data.author} · {formatDateTime(detail.data.createdAt)}</p>
        <FormattedText body={detail.data.body} />
        {detail.data.attachments.length > 0 && <section className="knowledge-attachment-list" aria-label="Вкладення звернення">{detail.data.attachments.map((file) => <div key={file.id}>{renderAttachment(file)}</div>)}</section>}
        <Button variant="danger" onClick={() => { remove.reset(); setDeleting(detail.data) }}><Trash2 size={16} />Видалити звернення</Button>
      </div>}
    </Modal>}
    {deleting && <ConfirmationDialog title="Видалити звернення?" description={`«${deleting.title}» буде прибрано зі списку звернень.`} onRequestClose={() => { if (!remove.isPending) setDeleting(null) }} onConfirm={() => remove.mutate(deleting)} confirmLabel={remove.isPending ? 'Видаляємо…' : 'Видалити'} confirmDisabled={remove.isPending}>
      {remove.isError && <p className="form-error" role="alert">Не вдалося видалити звернення. Спробуйте ще раз.</p>}
    </ConfirmationDialog>}
  </section>
}
