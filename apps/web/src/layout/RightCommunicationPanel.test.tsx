import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { getChatUser, getThreadDetail } from '../features/messages/api/messageApi'
import { RightCommunicationPanel } from './RightCommunicationPanel'

vi.mock('../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'viewer', company: { id: 'company-1' } } }),
}))

vi.mock('../shared/api/client', () => ({
  api: vi.fn(async () => ({
    id: 'employee', displayName: 'Працівник', username: 'employee',
    jobTitle: 'Адміністратор', primaryCompanyId: null, avatarAsset: null,
  })),
  apiUrl: (path: string) => path,
  jsonBody: JSON.stringify,
  idempotencyKey: () => 'test-key',
}))

vi.mock('../features/messages/api/messageApi', () => ({
  getThreadPage: vi.fn(async () => ({ items: [], nextCursor: null })),
  getChatUser: vi.fn(async () => ({
    id: 'employee', displayName: 'Працівник', username: 'employee',
    jobTitle: 'Адміністратор', avatarAsset: null, directThreadId: 'existing-thread',
  })),
  getThreadDetail: vi.fn(async () => ({
    id: 'existing-thread', title: 'Працівник', kind: 'DIRECT', canPost: true,
    participants: [{ id: 'employee', displayName: 'Працівник', username: 'employee' }],
  })),
  getMessagePage: vi.fn(async () => ({ items: [], olderCursor: null })),
  createThread: vi.fn(),
  sendMessage: vi.fn(),
  uploadMessageAttachment: vi.fn(),
}))

vi.mock('../features/messages/components/MessageComposer', () => ({
  MessageComposer: () => <textarea aria-label="Повідомлення" />,
}))

describe('RightCommunicationPanel profile entry', () => {
  it('opens the existing conversation when the employee has no primary company', async () => {
    HTMLElement.prototype.scrollTo = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <RightCommunicationPanel
            chatUnread={0}
            notificationUnread={0}
            targetUserId="employee"
            onClearTarget={vi.fn()}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(getThreadDetail).toHaveBeenCalledWith('existing-thread', expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Повідомлення' })).toBeInTheDocument())
    expect(getChatUser).toHaveBeenCalledWith('all', 'employee', expect.any(AbortSignal))
    expect(getThreadDetail).toHaveBeenCalledWith('existing-thread', expect.any(AbortSignal))
    expect(screen.getByRole('region', { name: 'Коротка інформація про користувача' })).toBeInTheDocument()
    expect(screen.queryByText('Не вдалося відкрити діалог')).not.toBeInTheDocument()
    client.clear()
  })
})
