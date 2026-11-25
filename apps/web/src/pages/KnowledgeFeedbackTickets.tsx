import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { HiddenContentMarker } from '@lankadws/contracts'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { hiddenContentLabel } from '../shared/lib/hiddenContent'
import { FormattedText } from '../shared/text/FormattedText'
import { Button, ConfirmationDialog, ErrorState, Modal, PageDataLoader } from '../shared/ui'
import { notifySuccess } from '../shared/ui/notify'

interface Ticket { id: string; title: string; author: string; createdAt: string; hidden?: HiddenContentMarker }
interface Attachment { id: string; safeFilename: string; bytes: number; mimeType: string | null; scanStatus: string }
interface TicketDetail extends Ticket { body: string; attachments: Attachment[] }
interface TicketPage { items: Ticket[]; nextCursor: string | null }

export function KnowledgeFeedbackTickets({ renderAttachment }: { renderAttachment: (attachment: Attachment) => ReactNode }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Ticket | null>(null)
  const [params, setParams] = useSearchParams()
  // «Архів» of archived tickets (decision 2026-11-18), URL-addressable as `tickets=archived`.
  const archived = params.get('tickets') === 'archived'
  const setArchived = (value: boolean) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    if (value) next.set('tickets', 'archived')
    else next.delete('tickets')
    return next
  }, { replace: true })
  const query = useInfiniteQuery({
    queryKey: ['feedback-tickets', user?.id, archived ? 'archived' : 'active'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams()
      if (archived) search.set('status', 'ARCHIVED')
      if (pageParam) search.set('cursor', pageParam)
      return api<TicketPage>(`/knowledge/tickets${search.toString() ? `?${search}` : ''}`)
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const invalidateTickets = () => client.invalidateQueries({ queryKey: ['feedback-tickets'] })
  const restore = useMutation({
    mutationFn: (ticket: Ticket) => api(`/knowledge/tickets/${ticket.id}/restore`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidateTickets()
      notifySuccess('Звернення відновлено')
    },
  })
  const detail = useQuery({ queryKey: ['feedback-ticket', user?.id, selected], queryFn: () => api<TicketDetail>(`/knowledge/tickets/${selected}`), enabled: Boolean(selected) })
  const remove = useMutation({
    mutationFn: (ticket: Ticket) => api(`/knowledge/tickets/${ticket.id}`, { method: 'DELETE' }),
    onSuccess: async (_, ticket) => {
      setDeleting(null)
      if (selected === ticket.id) setSelected(null)
      client.removeQueries({ queryKey: ['feedback-ticket', user?.id, ticket.id] })
      await invalidateTickets()
      notifySuccess('Звернення видалено', {
        undo: async () => {
          await api(`/knowledge/tickets/${ticket.id}/restore`, { method: 'POST' })
          await invalidateTickets()
        },
      })
    },
  })
  const tickets = query.data?.pages.flatMap((page) => page.items) ?? []
  return <section className="card knowledge-tickets" aria-labelledby="knowledge-tickets-title">
    <header>
      <h2 id="knowledge-tickets-title"><MessageCircle size={18} aria-hidden />Звернення до адміністратора</h2>
      <p>Відгуки й пропозиції команди. Їх бачать лише адміністратори.</p>
      <div className="knowledge-filters" role="group" aria-label="Звернення">
        <button type="button" className={!archived ? 'is-active' : ''} aria-pressed={!archived} onClick={() => setArchived(false)}>Нові</button>
        <button type="button" className={archived ? 'is-active' : ''} aria-pressed={archived} onClick={() => setArchived(true)}>Архів</button>
      </div>
    </header>
    {query.isPending ? <PageDataLoader /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <>
      {restore.isError && <p className="form-error" role="alert">Не вдалося відновити звернення. Оновіть список і спробуйте ще раз.</p>}
      {archived && tickets.length > 0 && <ul className="hidden-content-list" aria-label="Архів звернень">
        {tickets.map((ticket) => {
          const restoring = restore.isPending && restore.variables?.id === ticket.id
          return <li className="hidden-content-row" key={ticket.id}>
            <span className="hidden-content-row__body">
              <strong>{ticket.title}</strong>
              <small>{ticket.author} · {formatDateTime(ticket.createdAt)}</small>
              {ticket.hidden && <span className="hidden-content-row__marker">{hiddenContentLabel(ticket.hidden, 'Видалено')}</span>}
            </span>
            <Button variant="secondary" aria-label={`Відновити звернення ${ticket.title}`} disabled={restoring} onClick={() => restore.mutate(ticket)}>
              <RotateCcw size={16} aria-hidden />{restoring ? 'Відновлюємо…' : 'Відновити'}
            </Button>
          </li>
        })}
      </ul>}
      {!archived && tickets.length > 0 && <ul className="knowledge-ticket-list">
        {tickets.map((ticket) => <li className="knowledge-ticket-row" key={ticket.id}>
          <button type="button" className="knowledge-ticket-open" onClick={() => setSelected(ticket.id)}><strong>{ticket.title}</strong><small>{ticket.author} · {formatDateTime(ticket.createdAt)}</small></button>
          <Button variant="ghost" className="knowledge-ticket-delete" aria-label={`Видалити звернення ${ticket.title}`} title="Видалити звернення" onClick={() => { remove.reset(); setDeleting(ticket) }}><Trash2 size={16} aria-hidden /></Button>
        </li>)}
      </ul>}
      {!tickets.length && <p className="knowledge-tickets__empty">{archived ? 'В архіві звернень немає.' : 'Нових звернень поки немає.'}</p>}
      {query.hasNextPage && <Button variant="secondary" className="knowledge-tickets__more" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Завантажуємо…' : 'Показати ще'}</Button>}
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
