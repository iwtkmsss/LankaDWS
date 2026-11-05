import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { OverlayProvider } from '../ui'
import { MessageLikeButton } from './MessageLikeButton'

vi.mock('../api/client', () => ({ api: vi.fn() }))

function setup(count = 80, previewPlacement?: 'bottom' | 'right') {
  const onClick = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/', element: <OverlayProvider>
    <MessageLikeButton previewPlacement={previewPlacement} count={count} liked={false} onClick={onClick} reactionsUrl="/messages/message/reactions" />
  </OverlayProvider> }])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { onClick }
}
const users = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ id: `user-${start + index}`, displayName: `Особа ${start + index}` }))

beforeEach(() => vi.mocked(api).mockReset())

describe('message like users', () => {
  it('loads only on hover, shows five users, and preserves the like action', async () => {
    vi.mocked(api).mockResolvedValue({ items: users(1, 5), total: 80, nextCursor: '5' })
    const { onClick } = setup()
    expect(api).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: 'Подобається' })
    fireEvent.mouseEnter(button)
    const popup = await screen.findByRole('dialog', { name: 'Хто вподобав' })
    await waitFor(() => expect(within(popup).getAllByRole('listitem')).toHaveLength(5))
    expect(api).toHaveBeenCalledWith('/messages/message/reactions?limit=5', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(within(popup).getByRole('button', { name: 'Показати всіх · 80' })).toBeVisible()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'right'] as const)('positions the preview with placement %s', async (previewPlacement) => {
    vi.mocked(api).mockResolvedValue({ items: users(1, 2), total: 2, nextCursor: null })
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('message-like-button')
        ? { left: 100, right: 130, top: 100, bottom: 124, width: 30, height: 24 } as DOMRect
        : { width: 280, height: 100 } as DOMRect
    })
    try {
      setup(2, previewPlacement)
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Подобається' }))
      const popup = await screen.findByRole('dialog', { name: 'Хто вподобав' })
      await waitFor(() => expect(popup).toHaveStyle(previewPlacement === 'right'
        ? { left: '138px', top: '100px' }
        : { left: '100px', top: '132px' }))
    } finally { geometry.mockRestore() }
  })

  it('offers a paginated full list and keeps the preview open while entering it', async () => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (String(url).includes('cursor=50')) return { items: users(51, 30), total: 80, nextCursor: null } as never
      if (String(url).includes('limit=50')) return { items: users(1, 50), total: 80, nextCursor: '50' } as never
      return { items: users(1, 5), total: 80, nextCursor: '5' } as never
    })
    setup()
    const button = screen.getByRole('button', { name: 'Подобається' })
    fireEvent.focus(button)
    const showAll = await screen.findByRole('button', { name: 'Показати всіх · 80' })
    fireEvent.mouseLeave(button)
    fireEvent.mouseEnter(screen.getByRole('dialog', { name: 'Хто вподобав' }))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(showAll).toBeVisible()
    fireEvent.click(showAll)
    const list = await screen.findByRole('region', { name: 'Список користувачів, які вподобали' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(50))
    fireEvent.click(within(list).getByRole('button', { name: 'Показати ще' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(80))
    expect(within(list).queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument()
  })

  it('hides show-all for five or fewer and supports Escape', async () => {
    vi.mocked(api).mockResolvedValue({ items: users(1, 2), total: 2, nextCursor: null })
    setup(2)
    fireEvent.focus(screen.getByRole('button', { name: 'Подобається' }))
    await screen.findByText('Особа 1')
    expect(screen.queryByRole('button', { name: /Показати всіх/ })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
