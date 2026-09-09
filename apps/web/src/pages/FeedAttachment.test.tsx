import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverlayProvider } from '../shared/ui'
import { FeedAttachment } from './FeedPage'

describe('FeedAttachment', () => {
  it('opens an image over the CRM and keeps download as a separate action', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OverlayProvider>
          <FeedAttachment attachment={{
            id: 'feed-file',
            fileName: 'оновлення.png',
            bytes: 2048,
            mimeType: 'image/png',
            scanStatus: 'CLEAN',
          }} />
        </OverlayProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('link', { name: 'Завантажити оновлення.png' })).toHaveAttribute(
      'href',
      '/api/v1/files/feed-file/download',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути оновлення.png' }))

    const preview = screen.getByRole('dialog', { name: 'оновлення.png' })
    expect(within(preview).getByRole('img', { name: 'оновлення.png' })).toHaveAttribute(
      'src',
      '/api/v1/files/feed-file/download?inline=true',
    )
    expect(within(preview).getByRole('link', { name: 'Завантажити' })).toHaveAttribute(
      'href',
      '/api/v1/files/feed-file/download',
    )
  })
})
