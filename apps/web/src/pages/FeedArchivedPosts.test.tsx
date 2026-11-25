import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { FeedPostView } from '@lankadws/contracts'
import { api } from '../shared/api/client'
import { FeedArchivedPosts } from './FeedPage'

vi.mock('../shared/api/client', async (original) => ({ ...await original<typeof import('../shared/api/client')>(), api: vi.fn() }))
afterEach(() => { cleanup(); vi.mocked(api).mockReset() })

const archived: FeedPostView = {
  kind: 'POST', id: 'post', itemId: 'feed-post', companyId: 'company',
  author: { id: 'author', displayName: 'Марія Іваненко', avatarAsset: null },
  audienceLabel: 'Усі', body: 'Архівна новина', mentions: [], status: 'ARCHIVED',
  requiresAcknowledgement: false, acknowledgementVersion: 0, acknowledgementRequiredForMe: false,
  hasAcknowledged: false, acknowledgementCount: 0, acknowledgementRecipientCount: 0,
  likedByMe: false, likeCount: 0, commentCount: 0, comments: [], attachments: [],
  publishedAt: '2026-10-29T08:00:00Z', editedAt: null, version: 5, canEdit: false, canModerate: true,
  hidden: { hiddenAt: '2026-11-18T09:00:00Z', hiddenBy: { id: 'admin', displayName: 'Олена Адмін' } },
}

it('lists archived posts muted with who archived them and restores one at its version', async () => {
  let restored = false
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith('/feed/archived')) return { items: restored ? [] : [archived], nextCursor: null }
    if (path === '/feed/post/restore') { restored = true; return { id: 'post', version: 6 } }
    return null
  })
  const back = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter>
    <FeedArchivedPosts onBack={back} />
  </MemoryRouter></QueryClientProvider>)
  const section = screen.getByRole('region', { name: 'Архів публікацій' })
  expect(await within(section).findByText('Архівна новина')).toBeInTheDocument()
  expect(within(section).getByText(/Архівовано .* · Олена Адмін/)).toBeInTheDocument()
  fireEvent.click(within(section).getByRole('button', { name: /^Відновити публікацію/ }))
  await within(section).findByText('В архіві публікацій немає.')
  expect(api).toHaveBeenCalledWith('/feed/post/restore', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 5 }) }))
  fireEvent.click(within(section).getByRole('button', { name: 'Повернутися до стрічки' }))
  expect(back).toHaveBeenCalledOnce()
})
