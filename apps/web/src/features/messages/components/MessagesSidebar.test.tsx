import type {
  ChatContactUser,
  ChatThreadListItem,
  RecommendedChatUser,
} from '@bert-crm/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessagesSidebar } from './MessagesSidebar'

const contact: ChatContactUser = {
  id: 'usr_marko',
  displayName: 'Марко Литвин',
  username: 'marko',
  jobTitle: 'Дизайнер',
  avatarAsset: null,
}

const secondContact: ChatContactUser = {
  id: 'usr_maria',
  displayName: 'Марія Бондар',
  username: 'maria',
  jobTitle: 'Керівниця',
  avatarAsset: null,
}

const thread: ChatThreadListItem = {
  id: 'thread-1',
  companyId: 'company-1',
  title: 'Марко Литвин',
  kind: 'DIRECT',
  avatarAsset: null,
  previewParticipants: [contact],
  participantCount: 2,
  lastMessageAt: '2026-07-28T12:00:00.000Z',
  lastMessage: 'Останнє повідомлення',
  lastMessageId: 'message-1',
  unread: true,
  unreadCount: 2,
  notificationMode: 'ALL',
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof MessagesSidebar>> = {}) {
  const props: React.ComponentProps<typeof MessagesSidebar> = {
    threads: [thread],
    counts: { all: 8, unread: 3 },
    selectedThreadId: undefined,
    unreadOnly: false,
    query: '',
    debouncedQuery: '',
    searchResults: [],
    recommendations: [],
    loadingThreads: false,
    threadError: false,
    loadingSearch: false,
    loadingRecommendations: false,
    startingUserId: null,
    hasMoreThreads: false,
    loadingMoreThreads: false,
    onQueryChange: vi.fn(),
    onUnreadChange: vi.fn(),
    onSelectThread: vi.fn(),
    onStartDirect: vi.fn(),
    onOpenGroup: vi.fn(),
    onLoadMore: vi.fn(),
    onRetryThreads: vi.fn(),
    ...overrides,
  }
  return { ...render(<MessagesSidebar {...props} />), props }
}

describe('MessagesSidebar', () => {
  it('keeps the local group action icon-only and renders only real tabs', () => {
    const { props } = renderSidebar()

    const groupButton = screen.getByRole('button', { name: 'Нова група' })
    expect(groupButton).toHaveTextContent('')
    fireEvent.click(groupButton)
    expect(props.onOpenGroup).toHaveBeenCalledOnce()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.queryByRole('tab', { name: /Згадки/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /дзвін/i })).not.toBeInTheDocument()
  })

  it('shows the two-character hint without entering the results-only state', () => {
    renderSidebar({ query: 'м', debouncedQuery: 'м' })

    expect(screen.getByRole('status')).toHaveTextContent('щонайменше 2 символи')
    expect(screen.getByRole('button', { name: /Марко Литвин/ })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports keyboard selection and Escape in the user-only results state', () => {
    const onStartDirect = vi.fn()
    const onQueryChange = vi.fn()
    renderSidebar({
      query: 'мар',
      debouncedQuery: 'мар',
      searchResults: [contact, secondContact],
      onStartDirect,
      onQueryChange,
    })

    const input = screen.getByRole('combobox', { name: 'Пошук користувачів' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.queryByText('Останнє повідомлення')).not.toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onStartDirect).toHaveBeenCalledWith('usr_maria')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onQueryChange).toHaveBeenCalledWith('')
  })

  it('renders recommendations only when search is empty', () => {
    const recommendation: RecommendedChatUser = { ...contact, reason: 'FREQUENT' }
    const { rerender, props } = renderSidebar({ recommendations: [recommendation] })
    expect(screen.getByRole('region', { name: 'Рекомендовані контакти' })).toBeInTheDocument()

    rerender(<MessagesSidebar {...props} query="мар" debouncedQuery="мар" />)
    expect(screen.queryByRole('region', { name: 'Рекомендовані контакти' })).not.toBeInTheDocument()
  })
})
