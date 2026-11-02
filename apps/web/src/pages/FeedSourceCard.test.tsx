import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedSourceCard } from './FeedPage'

afterEach(() => vi.unstubAllGlobals())

describe('FeedSourceCard', () => {
  it.each([false, true])('changes a personal task pin in the production feed (pinned=%s)', async (pinnedByMe) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pinnedByMe: !pinnedByMe })))
    vi.stubGlobal('fetch', fetch)
    const changed = vi.fn()
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <FeedSourceCard isNew={false} onChanged={changed} item={{
        kind: 'SOURCE', id: 'task_1', itemId: 'feed_task', companyId: 'company_1',
        sourceType: 'TASK', pinnedByMe, action: 'CREATED', actor: null, label: 'Створено завдання', title: 'Завдання',
        summary: '', metadata: [], href: '/tasks/task_1', actionState: 'AVAILABLE', occurredAt: '2026-10-21T08:00:00Z',
        historical: false, version: 1, canRevoke: false,
      }} />
    </MemoryRouter></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: 'Дії з записом' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: pinnedByMe ? 'Відкріпити' : 'Закріпити для себе' })).toHaveAttribute('aria-pressed', String(pinnedByMe))
    expect(screen.queryByRole('menuitem', { name: 'Архівувати' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: pinnedByMe ? 'Відкріпити' : 'Закріпити для себе' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith('/api/v1/feed/tasks/task_1/pin', expect.objectContaining({ method: pinnedByMe ? 'DELETE' : 'POST' }))
  })

  it('omits the task description and keeps the unread changes block', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <FeedSourceCard isNew={false} onChanged={vi.fn()} item={{
        kind: 'SOURCE', id: 'task_formatted', itemId: 'feed_task_formatted', companyId: 'company_1',
        sourceType: 'TASK', action: 'CREATED', actor: null, label: 'Створено завдання', title: 'Доступи',
        summary: '|Керівник|**Підключити**|\n- *Корпоративна пошта*\n- [u]DUO[/u]\n[size=18]Доступ[/size]\n\\*звичайна зірочка\\*',
        metadata: [], href: '/tasks/task_formatted', actionState: 'AVAILABLE', occurredAt: '2026-10-21T08:00:00Z',
        historical: false, version: 1, canRevoke: false,
      }} />
    </MemoryRouter></QueryClientProvider>)
    expect(screen.getByText('Нових змін немає')).toBeVisible()
    expect(container.querySelector('.feed-source-card__summary')).toBeNull()
    expect(container).not.toHaveTextContent('Керівник')
    expect(container).not.toHaveTextContent('Підключити')
    expect(screen.getByRole('link', { name: 'Відкрити завдання' })).toHaveAttribute('href', '/tasks/task_formatted')
  })

  it('pins an event until explicit acknowledgement and refreshes both calendar and feed', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ acknowledged: true })))
    vi.stubGlobal('fetch', fetch)
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const changed = vi.fn()
    const item = {
      kind: 'SOURCE' as const, id: 'event_1', itemId: 'feed_event', companyId: 'company_1',
      sourceType: 'EVENT' as const, action: 'CREATED', actor: null, label: 'Подія календаря', title: 'Зустріч',
      summary: 'Опис', metadata: [], href: '/calendar/events/event_1', actionState: 'AVAILABLE' as const,
      occurredAt: '2026-10-23T09:00:00Z', historical: false, version: 1, eventVersion: 3, canRevoke: false,
      eventAcknowledgement: { requiredForMe: true, acknowledgedAt: null as string | null, recipientCount: 4, acknowledgedCount: 0 },
    }
    const view = (value: typeof item) => <QueryClientProvider client={client}><MemoryRouter>
      <FeedSourceCard item={value} isNew={false} onChanged={changed} />
    </MemoryRouter></QueryClientProvider>
    const { rerender } = render(view(item))
    expect(screen.queryByRole('button', { name: 'Дії з записом' })).not.toBeInTheDocument()
    expect(screen.getByText('Потрібне ознайомлення')).toBeVisible()
    expect(screen.getByTitle('Закріплено до ознайомлення')).toBeVisible()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ознайомився' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith('/api/v1/calendar/events/event_1/acknowledge', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 3 }),
    }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calendar-event'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['feed'] })
    rerender(view({ ...item, eventAcknowledgement: { ...item.eventAcknowledgement, acknowledgedAt: '2026-10-23T10:00:00Z', acknowledgedCount: 1 } }))
    expect(screen.queryByText('Потрібне ознайомлення')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Закріплено до ознайомлення')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ознайомився' })).not.toBeInTheDocument()
    expect(screen.getByText('Ви ознайомилися')).toBeVisible()
  })

  it('opens the canonical calendar event with its company and date', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/feed']}>
      <Routes>
        <Route path="/feed" element={<FeedSourceCard isNew={false} onChanged={vi.fn()} item={{
          kind: 'SOURCE', id: 'event_1', itemId: 'feed_event', companyId: 'company_1',
          sourceType: 'EVENT', action: 'CREATED',
          actor: { id: 'owner', displayName: 'Андрій Коваль', avatarAsset: null },
          label: 'Створено подію календаря', title: 'Огляд операцій', summary: '15 лип. 2026 р., 15:30 — 16:00',
          metadata: ['Europe/Kyiv'], href: '/calendar/events/event_1?company=company_1&date=2026-07-15',
          actionState: 'AVAILABLE', occurredAt: '2026-07-20T10:00:00Z', historical: false, version: 1, canRevoke: false,
        }} />} />
        <Route path="/calendar/events/:eventId" element={<h1>Деталі події</h1>} />
      </Routes>
    </MemoryRouter></QueryClientProvider>)
    expect(screen.queryByText('Europe/Kyiv')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Автор:/ })).toHaveAttribute('href', '/feed?employeeId=owner')
    const openEvent = screen.getByRole('link', { name: 'Відкрити подію' })
    expect(openEvent).toHaveAttribute('href', '/calendar/events/event_1?company=company_1&date=2026-07-15')
    fireEvent.click(openEvent)
    expect(screen.getByRole('heading', { name: 'Деталі події' })).toBeVisible()
  })

  it('does not render legacy standalone file shares', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <FeedSourceCard isNew={false} onChanged={vi.fn()} item={{
        kind: 'SOURCE', id: 'file_share', itemId: 'feed_file', companyId: 'company_1',
        sourceType: 'FILE', action: 'SHARED', actor: null, label: 'Поширено файл', title: 'notes.txt', summary: '', metadata: [],
        href: '/api/v1/files/file_1/download', actionState: 'AVAILABLE', occurredAt: '2026-10-16T08:00:00Z',
        historical: false, version: 1, canRevoke: false,
      }} />
    </MemoryRouter></QueryClientProvider>)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the task date without the last-event label and shows unread change counters', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FeedSourceCard isNew onChanged={vi.fn()} item={{
            kind: 'SOURCE', id: 'task_1', itemId: 'feed_1', companyId: 'company_1',
            sourceType: 'TASK', action: 'PARTICIPANT_CHANGED',
            actor: { id: 'editor_1', displayName: 'Інший автор зміни', avatarAsset: null },
            taskReporter: { id: 'reporter_1', displayName: 'Андрій Коваль', avatarAsset: null },
            taskAssignee: { id: 'assignee_1', displayName: 'Марія Іваненко', avatarAsset: null },
            taskChanges: { messages: 3, status: 0, participants: 2 },
            label: 'Новий відповідальний', title: 'Підготувати звіт', summary: '',
            metadata: ['Завдання: 42', 'Постановник: Андрій Коваль', 'Відповідальний: Марія Іваненко'], href: '/tasks/task_1',
            actionState: 'AVAILABLE', occurredAt: '2026-10-06T10:00:00Z',
            historical: false, version: 2, canRevoke: false,
          }} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const header = container.querySelector('.stream-card__source-copy')!
    expect(header.querySelector('time')).toHaveAttribute('dateTime', '2026-10-06T10:00:00Z')
    expect(header).toHaveTextContent('Задача 42')
    expect(screen.queryByText('Новий відповідальний')).not.toBeInTheDocument()
    expect(screen.getByText('Нові повідомлення').parentElement).toHaveTextContent('3')
    expect(screen.getByText('Зміна учасників').parentElement).toHaveTextContent('2')
    expect(screen.queryByText('Зміни завдання')).not.toBeInTheDocument()
    expect(screen.queryByText('Нових змін немає')).not.toBeInTheDocument()
    const reporter = screen.getByRole('link', { name: 'Постановник: Андрій Коваль' })
    expect(reporter).toHaveAttribute('href', '/?employeeId=reporter_1')
    const metadata = container.querySelector('.stream-metadata')!
    expect(metadata).toContainElement(reporter)
    const assignee = screen.getByRole('link', { name: 'Відповідальний: Марія Іваненко' })
    expect(assignee).toHaveAttribute('href', '/?employeeId=assignee_1')
    expect(metadata).toContainElement(assignee)
    expect(screen.queryByText('Інший автор зміни')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Відкрити завдання/ })).toHaveAttribute('href', '/tasks/task_1')
  })
})
