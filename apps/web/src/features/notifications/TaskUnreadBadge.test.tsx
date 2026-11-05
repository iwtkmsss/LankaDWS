import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { TaskUnreadBadge, useUnreadTaskCounts } from './TaskUnreadBadge'

vi.mock('../../shared/api/client', () => ({ api: vi.fn() }))

function Row({ id }: { id: string }) {
  const counts = useUnreadTaskCounts()
  return <p data-testid={id}><TaskUnreadBadge count={counts.get(id) ?? 0} /></p>
}

describe('task unread badge', () => {
  afterEach(cleanup)

  it('counts only task notifications, per task', async () => {
    vi.mocked(api).mockResolvedValue({ items: [
      { entityType: 'TASK', entityId: 'two' }, { entityType: 'TASK', entityId: 'two' },
      { entityType: 'TASK', entityId: 'one' }, { entityType: 'MESSAGE_THREAD', entityId: 'none' },
    ] })
    render(<QueryClientProvider client={new QueryClient()}><Row id="two" /><Row id="one" /><Row id="none" /></QueryClientProvider>)
    expect(await screen.findByLabelText('Непрочитаних оновлень: 2')).toHaveTextContent('Нове · 2')
    expect(screen.getByLabelText('Непрочитаних оновлень: 1')).toHaveTextContent(/^Нове$/)
    expect(screen.getByTestId('none')).toBeEmptyDOMElement()
    expect(api).toHaveBeenCalledOnce()
  })
})
