import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedSourceCard } from './FeedPage'
import { OverlayProvider } from '../shared/ui'

afterEach(() => vi.unstubAllGlobals())

describe('FeedSourceCard', () => {
  it.each([['Нотатки', ['text/plain']], ['notes.txt', []]])('opens shared text %s in the text reader', async (title, metadata) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Текст зі стрічки')))
    render(<QueryClientProvider client={new QueryClient()}><OverlayProvider><MemoryRouter>
      <FeedSourceCard isNew={false} onChanged={vi.fn()} item={{
        kind: 'SOURCE', id: 'file_share', itemId: 'feed_file', companyId: 'company_1',
        sourceType: 'FILE', action: 'SHARED', actor: null, label: 'Поширено файл', title, summary: '', metadata,
        href: '/api/v1/files/file_1/download', actionState: 'AVAILABLE', occurredAt: '2026-10-16T08:00:00Z',
        historical: false, version: 1, canRevoke: false,
      }} />
    </MemoryRouter></OverlayProvider></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Переглянути/ }))
    expect(await screen.findByLabelText(`Текст ${title}`)).toHaveTextContent('Текст зі стрічки')
  })

  it('places the date before the event with a dot and shows the task number label', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FeedSourceCard isNew onChanged={vi.fn()} item={{
            kind: 'SOURCE', id: 'task_1', itemId: 'feed_1', companyId: 'company_1',
            sourceType: 'TASK', action: 'PARTICIPANT_CHANGED',
            actor: { id: 'editor_1', displayName: 'Інший автор зміни', avatarAsset: null },
            taskReporter: { id: 'reporter_1', displayName: 'Андрій Коваль', avatarAsset: null },
            taskAssignee: { id: 'assignee_1', displayName: 'Марія Іваненко', avatarAsset: null },
            label: 'Новий відповідальний', title: 'Підготувати звіт', summary: '',
            metadata: ['Завдання: 42', 'Постановник: Андрій Коваль', 'Виконавець: Марія Іваненко'], href: '/tasks/task_1',
            actionState: 'AVAILABLE', occurredAt: '2026-10-06T10:00:00Z',
            historical: false, version: 2, canRevoke: false,
          }} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const header = container.querySelector('.feed-source-card__content > header')!
    expect(header.firstElementChild?.tagName).toBe('TIME')
    expect(header.children[1]).toHaveTextContent('·')
    expect(header.lastElementChild).toHaveTextContent('Новий відповідальний')
    expect(screen.getByText('Завдання: 42')).toBeVisible()
    const reporter = screen.getByRole('link', { name: 'Постановник: Андрій Коваль' })
    expect(reporter).toHaveAttribute('href', '/?employeeId=reporter_1')
    const metadata = container.querySelector('.feed-source-card__meta')!
    expect(metadata.children[1]).toContainElement(reporter)
    const assignee = screen.getByRole('link', { name: 'Виконавець: Марія Іваненко' })
    expect(assignee).toHaveAttribute('href', '/?employeeId=assignee_1')
    expect(metadata.children[2]).toContainElement(assignee)
    expect(screen.queryByText('Інший автор зміни')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Відкрити завдання/ })).toHaveAttribute('href', '/tasks/task_1')
  })
})
