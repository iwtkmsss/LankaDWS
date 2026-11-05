import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importFileToDrive } from '../../features/drive/api'
import { SaveToDriveButton } from './SaveToDriveButton'

vi.mock('../../features/drive/api', () => ({ importFileToDrive: vi.fn() }))
afterEach(() => vi.clearAllMocks())

describe('SaveToDriveButton', () => {
  it('saves the selected file once and refreshes Drive listings', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    let finish!: (value: { id: string; name: string }) => void
    vi.mocked(importFileToDrive).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<QueryClientProvider client={client}>
      <SaveToDriveButton fileId="file_one" fileName="Звіт.final.png" />
    </QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти на Диск' }))
    expect(screen.getByRole('button', { name: 'Зберігаємо…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Зберігаємо…' }))
    expect(importFileToDrive).toHaveBeenCalledExactlyOnceWith({ fileId: 'file_one', name: 'Звіт.final' })
    finish({ id: 'doc_copy', name: 'Звіт.final' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Збережено на Диск' })).toBeDisabled())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['drive'] })
  })

  it('allows retrying a failed save', async () => {
    vi.mocked(importFileToDrive).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'doc_copy', name: 'Звіт' })
    render(<SaveToDriveButton fileId="file_one" fileName="Звіт.png" />)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти на Диск' }))
    const retry = await screen.findByRole('button', { name: 'Не вдалося зберегти. Повторити' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await screen.findByRole('button', { name: 'Збережено на Диск' })
    expect(importFileToDrive).toHaveBeenCalledTimes(2)
  })
})
