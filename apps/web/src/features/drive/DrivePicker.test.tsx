import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../shared/api/client'
import { OverlayProvider } from '../../shared/ui'
import { DrivePicker } from './DrivePicker'

vi.mock('../../shared/api/client', async (load) => ({ ...await load<object>(), api: vi.fn() }))
const file = { id: 'nested-document', name: 'Звіт із вкладеної папки', fileType: 'PDF', sizeBytes: 1024 }
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), maxSelection?: number) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<QueryClientProvider client={client}><OverlayProvider><DrivePicker onPick={onPick} onClose={onClose} maxSelection={maxSelection} /></OverlayProvider></QueryClientProvider>)
  return { onPick, onClose, client }
}
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('Drive attachment picker', () => {
  it.each(['Довга назва звіту', 'Довга назва звіту.PDF'])('keeps the extension separate without duplicating it for %s', async (name) => {
    vi.mocked(api).mockResolvedValue({ folders: [], items: [{ ...file, name, extension: '.pdf' }], nextCursor: null })
    mount()
    const row = await screen.findByRole('button', { name: /Довга назва звіту/ })
    expect(row.querySelector('.compact-file-name__stem')).toHaveTextContent('Довга назва звіту')
    expect(row.querySelector('.compact-file-name__extension')?.textContent?.toLowerCase()).toBe('.pdf')
    expect(row.querySelector('.compact-file-name')?.textContent?.toLowerCase()).toBe('довга назва звіту.pdf')
  })

  it('shows a photo miniature and falls back to its format icon when loading fails', async () => {
    vi.mocked(api).mockResolvedValue({ folders: [], items: [
      { ...file, name: 'Фото', fileId: 'photo-file', fileType: 'IMAGE', mimeType: 'image/png' },
    ], nextCursor: null })
    mount()
    const row = await screen.findByRole('button', { name: /Фото/ })
    const miniature = row.querySelector('img')!
    expect(miniature.getAttribute('src')).toContain('/files/photo-file/download?inline=true')
    expect(miniature).toHaveAttribute('draggable', 'false')
    fireEvent.error(miniature)
    expect(row.querySelector('img')).toBeNull()
    expect(row.querySelector('.file-format-icon--image')).not.toBeNull()
  })

  it('uses shared image and archive icons even without MIME metadata', async () => {
    vi.mocked(api).mockResolvedValue({ folders: [], items: [
      { ...file, id: 'image', name: 'Фото', fileType: 'IMAGE' },
      { ...file, id: 'archive', name: 'backup.zip', fileType: 'OTHER', mimeType: 'application/octet-stream' },
    ], nextCursor: null })
    mount()
    const image = await screen.findByRole('button', { name: /Фото/ })
    expect(image.querySelector('.file-format-icon--image')).not.toBeNull()
    expect(screen.getByRole('button', { name: /backup.zip/ }).querySelector('.file-format-icon--archive')).not.toBeNull()
  })

  it('respects the remaining attachment limit and allows changing a selection', async () => {
    vi.mocked(api).mockResolvedValue({ folders: [], items: [file, { ...file, id: 'second', name: 'Другий файл' }], nextCursor: null })
    mount(undefined, 1)
    const first = await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })
    const second = screen.getByRole('button', { name: /Другий файл/ })
    fireEvent.click(first)
    expect(second).toBeDisabled()
    expect(first).toBeEnabled()
    fireEvent.click(first)
    expect(second).toBeEnabled()
    fireEvent.click(second)
    expect(first).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Вибрано: 1 із 1')
  })

  it('lists root files and prepares the selected attachment', async () => {
    const attachment = { id: 'attachment', fileName: 'report.pdf' }
    vi.mocked(api).mockImplementation((path) => Promise.resolve(path.includes('/as-attachment') ? attachment : { folders: [], items: [file], nextCursor: null }))
    const { onPick, onClose } = mount()
    fireEvent.click(await screen.findByRole('button', { name: /Звіт із вкладеної папки/ }))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Звіт із вкладеної папки/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Прикріпити (1)' }))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(attachment))
    expect(onClose).toHaveBeenCalledOnce()
    expect(api).toHaveBeenCalledWith('/drive/picker?', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/drive/documents/nested-document/as-attachment')).toBe(true)
  })

  it('preserves multiple selections across folders and search, and allows deselection', async () => {
    vi.mocked(api).mockImplementation((path) => Promise.resolve(path.includes('/as-attachment')
      ? { id: path.includes('second') ? 'attachment-2' : 'attachment-1' }
      : path.includes('folderId=') || path.includes('search=')
        ? { folders: [], items: [{ ...file, id: 'second', name: 'Другий файл' }], nextCursor: null }
        : { folders: [{ id: 'folder', name: 'Папка' }], items: [file], nextCursor: null }))
    const { onPick, onClose } = mount()
    expect(screen.getByRole('button', { name: 'Прикріпити (0)' })).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: /Звіт із вкладеної папки/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити папку Папка' }))
    fireEvent.click(await screen.findByRole('button', { name: /Другий файл/ }))
    expect(screen.getByRole('button', { name: 'Прикріпити (2)' })).toBeEnabled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Другий' } })
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('search='), expect.anything()))
    const second = await screen.findByRole('button', { name: /Другий файл/ })
    expect(second).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(second)
    expect(screen.getByRole('button', { name: 'Прикріпити (1)' })).toBeEnabled()
    fireEvent.click(second)
    fireEvent.click(screen.getByRole('button', { name: 'Прикріпити (2)' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onPick.mock.calls).toEqual([[{ id: 'attachment-1' }], [{ id: 'attachment-2' }]])
  })

  it('keeps only failed selections for retry after a partial attachment failure', async () => {
    let attempts = 0
    vi.mocked(api).mockImplementation((path) => {
      if (path.includes('second/as-attachment') && ++attempts === 1) return Promise.reject(new Error('network'))
      return Promise.resolve(path.includes('/as-attachment') ? { id: path }
        : { folders: [], items: [file, { ...file, id: 'second', name: 'Другий файл' }], nextCursor: null })
    })
    const { onPick, onClose } = mount()
    fireEvent.click(await screen.findByRole('button', { name: /Звіт із вкладеної папки/ }))
    fireEvent.click(screen.getByRole('button', { name: /Другий файл/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Прикріпити (2)' }))
    await screen.findByText(/Не вдалося прикріпити всі/)
    expect(onClose).not.toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Звіт із вкладеної папки/ })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Прикріпити (1)' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  it('navigates folders, subfolders, breadcrumbs and Back without attaching a folder', async () => {
    vi.mocked(api).mockImplementation((path) => {
      const folderId = new URLSearchParams(path.split('?')[1]).get('folderId')
      return Promise.resolve(folderId === 'child' ? { folders: [], items: [file], nextCursor: null }
        : { folders: [{ id: folderId ? 'child' : 'parent', name: folderId ? 'Вкладена' : 'Договори' }], items: [], nextCursor: null })
    })
    const { onPick, onClose } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Відкрити папку Договори' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Відкрити папку Вкладена' }))
    expect(await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Вкладена' })).toHaveAttribute('aria-current', 'page')
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Назад до попередньої папки' }))
    expect(await screen.findByRole('button', { name: 'Відкрити папку Вкладена' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Мій диск' }))
    expect(await screen.findByRole('button', { name: 'Відкрити папку Договори' })).toBeVisible()
  })

  it('keeps navigation available in an empty folder', async () => {
    vi.mocked(api).mockImplementation((path) => Promise.resolve(path.includes('folderId=empty')
      ? { folders: [], items: [], nextCursor: null }
      : { folders: [{ id: 'empty', name: 'Порожня' }], items: [], nextCursor: null }))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Відкрити папку Порожня' }))
    expect(await screen.findByText('Ця папка порожня.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Мій диск' }))
    expect(await screen.findByRole('button', { name: 'Відкрити папку Порожня' })).toBeVisible()
  })

  it('shows a retry action for a request error instead of claiming the disk is empty', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ folders: [], items: [file], nextCursor: null })
    mount()
    const retry = await screen.findByRole('button', { name: 'Спробувати ще раз' })
    expect(screen.queryByText('На диску ще немає файлів.')).not.toBeInTheDocument()
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })).toBeVisible()
  })

  it('loads further files when scrolling and searches on the server', async () => {
    vi.mocked(api).mockImplementation((path) => Promise.resolve(path.includes('search=')
      ? { folders: [], items: [{ ...file, id: 'search', name: 'Результат пошуку' }], nextCursor: null }
      : path.includes('cursor=next') ? { folders: [], items: [{ ...file, id: 'second', name: 'Другий файл' }], nextCursor: null }
        : { folders: [], items: [file], nextCursor: 'next' }))
    mount()
    await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })
    const list = screen.getByRole('list')
    Object.defineProperties(list, { scrollHeight: { value: 600 }, clientHeight: { value: 300 }, scrollTop: { value: 290, writable: true } })
    fireEvent.scroll(list)
    expect(await screen.findByRole('button', { name: /Другий файл/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Звіт із вкладеної папки/ })).toBeVisible()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Результат' } })
    expect(await screen.findByRole('button', { name: /Результат пошуку/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Другий файл/ })).not.toBeInTheDocument()
  })

  it('virtualizes thousands of rows and supports keyboard navigation to the ends', async () => {
    vi.mocked(api).mockResolvedValue({ folders: [], items: Array.from({ length: 2000 }, (_, index) => ({ ...file, id: `file-${index}`, name: `File ${index}` })), nextCursor: null })
    mount()
    const first = await screen.findByRole('button', { name: /^File 0 / })
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    expect(screen.queryByRole('button', { name: /^File 1999 / })).not.toBeInTheDocument()
    fireEvent.keyDown(first, { key: 'End' })
    const last = await screen.findByRole('button', { name: /^File 1999 / })
    expect(last).toHaveFocus()
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    fireEvent.keyDown(last, { key: 'Home' })
    expect(await screen.findByRole('button', { name: /^File 0 / })).toHaveFocus()
  })

  it('restores the loaded root list and scroll position after returning from a folder', async () => {
    vi.mocked(api).mockImplementation((path) => Promise.resolve(path.includes('folderId=')
      ? { folders: [], items: [], nextCursor: null }
      : { folders: Array.from({ length: 100 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}` })), items: [], nextCursor: null }))
    const { client } = mount()
    await screen.findByRole('button', { name: 'Відкрити папку Folder 0' })
    const list = screen.getByRole('list')
    list.scrollTop = 2600
    fireEvent.scroll(list)
    fireEvent.click(await screen.findByRole('button', { name: 'Відкрити папку Folder 50' }))
    await screen.findByText('Ця папка порожня.')
    await client.invalidateQueries({ queryKey: ['drive', 'picker'], refetchType: 'none' })
    fireEvent.click(screen.getByRole('button', { name: 'Назад до попередньої папки' }))
    expect(await screen.findByRole('button', { name: 'Відкрити папку Folder 50' })).toBeVisible()
    expect(screen.getByRole('list').scrollTop).toBe(2600)
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/drive/picker?')).toHaveLength(1)
  })

  it('fetches a fresh list when the dialog is reopened with the same application cache', async () => {
    vi.mocked(api).mockResolvedValue({ folders: [], items: [file], nextCursor: null })
    const { client } = mount()
    await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })
    cleanup()
    vi.mocked(api).mockResolvedValue({ folders: [], items: [{ ...file, name: 'Новий файл' }], nextCursor: null })
    mount(client)
    expect(await screen.findByRole('button', { name: /Новий файл/ })).toBeVisible()
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/drive/picker?')).toHaveLength(2)
  })

  it('keeps loaded files after a later page fails and retries that page explicitly', async () => {
    let attempts = 0
    vi.mocked(api).mockImplementation((path) => {
      if (!path.includes('cursor=')) return Promise.resolve({ folders: [], items: [file], nextCursor: 'next' })
      if (++attempts === 1) return Promise.reject(new Error('network'))
      return Promise.resolve({ folders: [], items: [{ ...file, id: 'second', name: 'Другий файл' }], nextCursor: null })
    })
    mount()
    await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })
    fireEvent.scroll(screen.getByRole('list'))
    const retry = await screen.findByRole('button', { name: 'Повторити завантаження файлів' })
    expect(screen.getByRole('button', { name: /Звіт із вкладеної папки/ })).toBeVisible()
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: /Другий файл/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Звіт із вкладеної папки/ })).toBeVisible()
  })

  it('shows the server-provided location in search and cancels an obsolete search request', async () => {
    let pendingSignal: AbortSignal | undefined
    vi.mocked(api).mockImplementation((path, options) => {
      const search = new URLSearchParams(path.split('?')[1]).get('search')
      if (search === 'old') { pendingSignal = options?.signal as AbortSignal; return new Promise(() => {}) }
      return Promise.resolve({ folders: [], items: [{ ...file, folderPath: ['Мій диск', 'Договори', '2026'] }], nextCursor: null })
    })
    mount()
    await screen.findByRole('button', { name: /Звіт із вкладеної папки/ })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'old' } })
    await waitFor(() => expect(pendingSignal).toBeDefined())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } })
    expect(await screen.findByText('Мій диск / Договори / 2026')).toBeVisible()
    expect(pendingSignal?.aborted).toBe(true)
  })
})
