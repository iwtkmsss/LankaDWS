import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem, api } from '../../shared/api/client'
import { OverlayProvider } from '../../shared/ui/Overlay'
import { TopbarContent, TopbarContentProvider } from '../../layout/TopbarContent'
import DrivePage from './DrivePage'

const auth = vi.hoisted(() => ({ accountType: 'USER' }))
vi.mock('../../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'usr_me', accountType: auth.accountType, company: { id: 'cmp_one' } } }),
}))
vi.mock('../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: vi.fn(),
}))

const folder = {
  id: 'fol_contracts', name: 'Договори', parentId: null, companyId: 'cmp_one',
  ownerId: 'usr_me', ownerName: 'Я', isOwner: true, sharedWithCount: 2, childCount: 1,
  sizeBytes: 2048, updatedAt: '2026-09-04T10:00:00.000Z', trashedAt: null,
}
const file = {
  id: 'doc_one', number: 'DOC-1', name: 'Звіт', companyId: 'cmp_one', folderId: null,
  fileId: 'file_image', mimeType: 'image/png', extension: '.png', fileType: 'IMAGE' as const, sizeBytes: 2048,
  ownerId: 'usr_me', ownerName: 'Я', isOwner: true, sharedWithCount: 0,
  version: 3, updatedAt: '2026-09-03T10:00:00.000Z', trashedAt: null,
}
const counts = { MY_DRIVE: 2, SHARED: 0, RECENT: 1, TRASH: 0 }

let lastDriveUrl = ''

function mount(initialEntry = '/drive') {
  const router = createMemoryRouter(
    [{ path: '/drive', element: <OverlayProvider><TopbarContentProvider><TopbarContent /><DrivePage /></TopbarContentProvider></OverlayProvider> }],
    { initialEntries: [initialEntry] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  auth.accountType = 'USER'
  lastDriveUrl = ''
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith('/drive/destinations?')) {
      const destination = new URLSearchParams(path.split('?')[1]).get('folderId')
      return { items: destination ? [] : [{ id: folder.id, name: folder.name, hasChildren: false }], nextCursor: null }
    }
    if (path.startsWith('/drive?') || path === '/drive') {
      lastDriveUrl = path
      const url = new URLSearchParams(path.split('?')[1] ?? '')
      const inFolder = url.get('folderId')
      return {
        breadcrumbs: inFolder ? [{ id: 'fol_contracts', name: 'Договори' }] : [],
        folders: inFolder ? [] : [folder],
        files: inFolder ? [file] : [file],
        counts,
      }
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe('DrivePage', () => {
  it.each(['GRID', 'LIST'])('uses shared Office icons in the %s layout', async (layout) => {
    localStorage.setItem('drive:layout', layout)
    const formats = [
      ['application/msword', 'Word'], ['application/vnd.ms-excel', 'Excel'], ['application/vnd.ms-powerpoint', 'PowerPoint'],
    ]
    vi.mocked(api).mockResolvedValue({ folders: [], files: formats.map(([mimeType, name]) => ({
      ...file, id: name, name, mimeType, fileType: 'OTHER', extension: null,
    })), breadcrumbs: [], counts })
    mount()
    for (const [, name] of formats) {
      const icons = await screen.findAllByRole('img', { name: `Формат ${name}` })
      expect(icons).toHaveLength(layout === 'GRID' ? 2 : 1)
      icons.forEach((icon) => expect(icon).toHaveClass('file-format-icon--office'))
    }
  })

  it('creates a nested folder in the currently opened folder', async () => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation((path, options) => path === '/drive/folders'
      ? Promise.resolve({ ...folder, id: 'nested', parentId: folder.id, name: 'Вкладена' }) : original(path, options))
    mount('/drive?folder=fol_contracts')
    await screen.findByText('Звіт')
    fireEvent.click(screen.getByRole('button', { name: 'Нова папка' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Назва папки' }), { target: { value: 'Вкладена' } })
    fireEvent.click(screen.getByRole('button', { name: 'Створити' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/drive/folders', {
      method: 'POST', body: JSON.stringify({ name: 'Вкладена', parentId: 'fol_contracts' }),
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('opens a folder from the card background while keeping the menu separate', async () => {
    mount()
    const card = (await screen.findByText('Договори')).closest('article')!
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Договори' }))
    expect(screen.getByRole('menu')).toBeVisible()
    expect(lastDriveUrl).not.toContain('folderId=')
    fireEvent.click(card)
    await waitFor(() => expect(lastDriveUrl).toContain('folderId=fol_contracts'))
  })
  it.each(['GRID', 'LIST'])('opens a folder by its size in %s', async (layout) => {
    mount()
    await screen.findByText('Договори')
    if (layout === 'LIST') fireEvent.click(screen.getByRole('button', { name: 'Список' }))
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити папку Договори' }))
    await waitFor(() => expect(lastDriveUrl).toContain('folderId=fol_contracts'))
    expect(await within(screen.getByRole('navigation', { name: 'Шлях' })).findByText('Договори')).toBeVisible()
  })
  it('keeps owner browsing hidden for ordinary users, including a forged URL', async () => {
    mount('/drive?view=USERS&owner=usr_other')
    await screen.findByText('Звіт')
    expect(screen.queryByRole('button', { name: 'Файли користувачів' })).not.toBeInTheDocument()
    expect(lastDriveUrl).toContain('view=MY_DRIVE')
    expect(lastDriveUrl).not.toContain('ownerId=')
    expect(vi.mocked(api).mock.calls.some(([path]) => path.startsWith('/drive/owners'))).toBe(false)
  })

  it('lets an admin open a tagged owner folder and preserves owner and view while navigating', async () => {
    auth.accountType = 'ADMIN'
    const owner = { id: 'usr_other', displayName: 'Іван Коваль', username: 'ivan.koval' }
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith('/drive/owners?')) return { items: [{ ...owner, itemCount: 2 }], nextCursor: null }
      const result = await original(path, options) as Record<string, unknown>
      return path.startsWith('/drive?') && path.includes('ownerId=') ? { ...result, owner } : result
    })
    const router = mount()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Розділи диска' })).getByRole('button', { name: 'Файли користувачів' }))
    fireEvent.click(await screen.findByRole('button', { name: /Іван Коваль @ivan.koval/ }))
    await waitFor(() => expect(lastDriveUrl).toContain('ownerId=usr_other'))
    expect(await screen.findByText('@ivan.koval')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Завантажити' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByText('Договори'))
    await waitFor(() => expect(lastDriveUrl).toContain('folderId=fol_contracts'))
    expect(new URLSearchParams(router.state.location.search).get('view')).toBe('USERS')
    expect(new URLSearchParams(router.state.location.search).get('owner')).toBe('usr_other')
    expect(lastDriveUrl).toContain('ownerId=usr_other')
  })

  it('paginates the admin owner directory without listing all users', async () => {
    auth.accountType = 'ADMIN'
    vi.mocked(api).mockImplementation(async (path) => {
      if (!path.startsWith('/drive/owners?')) throw new Error(`Unexpected request: ${path}`)
      return path.includes('cursor=first')
        ? { items: [{ id: 'second', displayName: 'Другий', username: 'second', itemCount: 1 }], nextCursor: null }
        : { items: [{ id: 'first', displayName: 'Перший', username: 'first', itemCount: 1 }], nextCursor: 'first' }
    })
    mount('/drive?view=USERS')
    await screen.findByText('@first')
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
    await screen.findByText('@second')
    expect(screen.queryByText('@first')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'На початок' }))
    expect(await screen.findByText('@first')).toBeVisible()
  })

  it.each([
    ['GRID', 'VIEWER'], ['GRID', 'EDITOR'], ['LIST', 'VIEWER'], ['LIST', 'EDITOR'],
  ])('shows effective %s/%s access and inherited sharing', async (layout, accessRole) => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, options) => {
      const result = await original(path, options) as Record<string, unknown>
      return path.startsWith('/drive?') ? { ...result, files: [{ ...file, isOwner: false, accessRole, isShared: true }] } : result
    })
    mount()
    await screen.findByText('Звіт')
    if (layout === 'LIST') fireEvent.click(screen.getByRole('button', { name: 'Список' }))
    const tile = screen.getByText('Звіт').closest(layout === 'LIST' ? 'tr' : 'article')!
    expect(screen.getByText('Договори').closest(layout === 'LIST' ? 'tr' : 'article')!.querySelector('.drive-item__indicators')).toBeNull()
    expect(within(tile as HTMLElement).getByRole('img', { name: accessRole === 'EDITOR' ? 'Доступно для редагування' : 'Доступно для перегляду' })).toBeVisible()
    expect(within(tile as HTMLElement).getByRole('img', { name: 'Спільний доступ' })).toBeVisible()
    fireEvent.click(within(tile as HTMLElement).getByRole('button', { name: 'Дії: Звіт' }))
    if (accessRole === 'EDITOR') expect(screen.getByRole('button', { name: 'Перейменувати' })).toBeVisible()
    else expect(screen.queryByRole('button', { name: 'Перейменувати' })).not.toBeInTheDocument()
  })
  it.each([
    ['file_type', 400, 'Доступні формати: PDF'],
    ['file_size', 400, 'Максимальний розмір — 100 МБ'],
    ['http_413', 413, 'Максимальний розмір — 100 МБ'],
    ['file_empty', 400, 'Файл порожній'],
    ['http_500', 500, 'Спробуйте ще раз'],
  ])('explains upload failure %s', async (code, status, message) => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation((path, options) => path === '/files'
      ? Promise.reject(new ApiProblem({ type: 'about:blank', title: 'Помилка', status, code, correlationId: 'test' }))
      : original(path, options))
    mount()
    await screen.findByText('Звіт')
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['data'], 'report.pdf', { type: 'application/pdf' })] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('rejects an oversized batch before uploading any of its files', async () => {
    mount()
    await screen.findByText('Звіт')
    const oversized = new File(['data'], 'large.zip')
    Object.defineProperty(oversized, 'size', { value: 100 * 1024 * 1024 + 1 })
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['data'], 'small.txt'), oversized] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Максимальний розмір — 100 МБ')
    expect(api).not.toHaveBeenCalledWith('/files', expect.anything())
  })
  it('moves a file through the folder picker in its menu', async () => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, options) => path === '/drive/documents/doc_one/move'
      ? { version: 4 } : original(path, options))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Звіт' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Перемістити' }))
    const destinations = await screen.findByRole('menu', { name: 'Папки призначення' })
    fireEvent.click(await within(destinations).findByRole('menuitem', { name: 'Договори' }))
    const branch = await screen.findByRole('menu', { name: 'Перемістити в Договори' })
    const confirm = within(branch).getByRole('menuitem', { name: 'Перемістити сюди' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/drive/documents/doc_one/move', {
      method: 'POST', body: JSON.stringify({ folderId: 'fol_contracts', expectedVersion: 3 }),
    }))
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Перемістити в Договори' })).not.toBeInTheDocument())
  })
  it('moves a folder into an unvisited nested destination from the same menu', async () => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation((path, options) => {
      if (path.startsWith('/drive/destinations?')) {
        const params = new URLSearchParams(path.split('?')[1])
        expect(params.get('targetType')).toBe('FOLDER')
        expect(params.get('targetId')).toBe('fol_contracts')
        return Promise.resolve({ items: params.get('folderId') === 'destination' ? [{ id: 'nested', name: 'Вкладена', hasChildren: false }]
          : params.get('folderId') === 'nested' ? [] : [{ id: 'destination', name: 'Інша папка', hasChildren: true }], nextCursor: null })
      }
      if (path === '/drive/folders/fol_contracts/move') return Promise.resolve({ moved: true })
      return original(path, options)
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Договори' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Перемістити' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Інша папка' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Вкладена' }))
    const confirm = screen.getByRole('menuitem', { name: 'Перемістити сюди' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/drive/folders/fol_contracts/move', { method: 'POST', body: JSON.stringify({ parentId: 'nested' }) }))
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Перемістити в Вкладена' })).not.toBeInTheDocument())
  })
  it('deletes from the preview, closes it and refreshes the Drive list', async () => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation((path, options) => path === '/documents/doc_one/archive'
      ? Promise.resolve({ archived: true }) : original(path, options))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Переглянути: Звіт' }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Зберегти на Диск' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api).toHaveBeenCalledWith('/documents/doc_one/archive', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 3 }) }))
  })

  it('keeps the preview open and shows an error when deletion fails', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Переглянути: Звіт' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Не вдалося перемістити в кошик.')
  })

  it('shows file and folder deletion to an administrator for items owned by others', async () => {
    auth.accountType = 'ADMIN'
    vi.mocked(api).mockResolvedValue({ breadcrumbs: [], folders: [{ ...folder, isOwner: false }], files: [{ ...file, isOwner: false }], counts })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Договори' }))
    expect(screen.getByRole('button', { name: 'Видалити' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Звіт' }))
    expect(within(screen.getAllByRole('menu')[1]!).getByRole('button', { name: 'Видалити' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути: Звіт' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити' })).toBeVisible()
  })

  it('hides deletion for an ordinary reader of a shared file', async () => {
    vi.mocked(api).mockResolvedValue({ breadcrumbs: [], folders: [], files: [{ ...file, isOwner: false }], counts })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Звіт' }))
    expect(screen.queryByRole('button', { name: 'Видалити' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути: Звіт' }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Видалити' })).not.toBeInTheDocument()
  })
  it.each(['GRID', 'LIST'])('opens a file preview on right-click in %s layout', async (layout) => {
    localStorage.setItem('drive:layout', layout)
    mount()
    const name = await screen.findByText('Звіт')
    fireEvent.contextMenu(name)
    expect(screen.getByRole('dialog', { name: 'Звіт' })).toBeVisible()
    expect(screen.getByText('Номер: DOC-1')).toBeVisible()
  })
  it('shows file metadata and a separate file tab link without the details action', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Звіт' }))
    expect(screen.queryByText('Деталі та версії')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Номер: DOC-1')).toBeVisible()
    expect(within(dialog).getByText(/Оновлено:/)).toBeVisible()
    const link = within(dialog).getByRole('link', { name: 'Відкрити файл у новій вкладці' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('href')).toContain('/files/file_image/download?inline=true')
  })

  it('lets an administrator add and revoke access to a folder owned by another user', async () => {
    auth.accountType = 'ADMIN'
    const share = { id: 'share_one', principalId: 'usr_other', principalName: 'Олена', avatarAsset: 'file_avatar', role: 'VIEWER' }
    let shares: typeof share[] = []
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith('/drive?')) return { breadcrumbs: [], folders: [{ ...folder, isOwner: false }], files: [], counts }
      if (path.startsWith('/employees?')) return { items: [{ id: 'usr_other', displayName: 'Олена', jobTitle: '' }] }
      if (path === '/drive/shares' && options?.method === 'POST') { shares = [{ ...share, role: JSON.parse(options.body as string).role }]; return shares }
      if (path === '/drive/shares/share_one' && options?.method === 'DELETE') { shares = []; return shares }
      if (path.startsWith('/drive/shares?')) return shares
      throw new Error(`Unexpected request: ${path}`)
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Дії: Договори' }))
    fireEvent.click(screen.getByRole('button', { name: 'Доступ' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Людина' }), { target: { value: 'О' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Олена/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Надати' }))
    const revoke = await screen.findByRole('button', { name: 'Відкликати доступ: Олена' })
    expect(revoke.closest('li')?.querySelector('img')).toHaveAttribute('src', '/api/v1/me/avatar/file_avatar')
    fireEvent.change(screen.getByRole('combobox', { name: 'Рівень доступу: Олена' }), { target: { value: 'EDITOR' } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Рівень доступу: Олена' })).toHaveValue('EDITOR'))
    fireEvent.click(revoke)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Відкликати доступ: Олена' })).not.toBeInTheDocument())
    expect(api).toHaveBeenCalledWith('/drive/shares', expect.objectContaining({ method: 'POST', body: JSON.stringify({ targetType: 'FOLDER', targetId: folder.id, principalType: 'USER', principalId: 'usr_other', role: 'VIEWER' }) }))
    expect(api).toHaveBeenCalledWith('/drive/shares/share_one', expect.objectContaining({ method: 'DELETE' }))
  })
  it('shows folders and files together with the shared-with marker', async () => {
    mount()

    expect(await screen.findByText('Договори')).toBeVisible()
    expect(screen.getByText('Звіт')).toBeVisible()
    expect(screen.getByText('Договори').closest('article')).toHaveAttribute('title', '1 вкладених')
    expect(screen.getByText('Договори').closest('article')).toHaveTextContent('2 КБ')
    expect(screen.getByText('.png')).toBeVisible()
    expect(screen.getByTitle('Звіт.png')).toBeVisible()
  })

  it('does not duplicate the extension already present in a file name', async () => {
    vi.mocked(api).mockResolvedValue({ breadcrumbs: [], folders: [], files: [{ ...file, name: 'Звіт.PNG' }], counts })
    mount()
    expect(await screen.findByTitle('Звіт.PNG')).toBeVisible()
    expect(screen.queryByText('.png')).not.toBeInTheDocument()
  })

  it('navigates into a folder and shows the breadcrumb trail', async () => {
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Договори' }))

    await waitFor(() => expect(lastDriveUrl).toContain('folderId=fol_contracts'))
    const trail = await screen.findByRole('navigation', { name: 'Шлях' })
    expect(within(trail).getByRole('button', { name: 'Мій диск' })).toBeVisible()
    expect(within(trail).getByRole('button', { name: 'Договори' })).toBeVisible()
  })

  it('sends the chip filters to the API and marks the chip active', async () => {
    mount()
    await screen.findByText('Звіт')

    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'IMAGE' } })

    await waitFor(() => expect(lastDriveUrl).toContain('type=IMAGE'))
    expect(screen.getByRole('button', { name: 'Скинути фільтр «Тип»' })).toBeVisible()
  })

  it('switches to the trash view', async () => {
    mount()
    await screen.findByText('Звіт')

    fireEvent.click(screen.getByRole('button', { name: /Кошик/ }))

    await waitFor(() => expect(lastDriveUrl).toContain('view=TRASH'))
  })

  it('keeps the chosen layout in the list toggle', async () => {
    mount()
    await screen.findByText('Звіт')

    fireEvent.click(screen.getByRole('button', { name: 'Список' }))

    expect(screen.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: /Назва/ })).toBeVisible()
  })

  it.each(['GRID', 'LIST'])('moves a mixed native/internal drag into a folder in %s without activating upload', async (layout) => {
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, options) => path === '/drive/documents/doc_one/move'
      ? { version: 4 } : original(path, options))
    mount()
    await screen.findByText('Звіт')
    if (layout === 'LIST') fireEvent.click(screen.getByRole('button', { name: 'Список' }))

    const payload = JSON.stringify({ kind: 'FILE', id: 'doc_one', version: 3 })
    const dataTransfer = {
      types: ['application/x-lankadws-drive-item', 'Files', 'text/uri-list'],
      files: [new File(['preview'], 'preview.png', { type: 'image/png' })],
      getData: (type: string) => type === 'application/x-lankadws-drive-item' ? payload : '',
      dropEffect: '',
    }
    const folderTile = screen.getByText('Договори').closest(layout === 'LIST' ? 'tr' : 'article')!
    const page = folderTile.closest('.drive-page')!

    fireEvent.dragEnter(page, { dataTransfer })
    expect(screen.queryByText('Відпустіть, щоб завантажити на Диск')).not.toBeInTheDocument()
    fireEvent.dragOver(folderTile, { dataTransfer })
    expect(folderTile).toHaveClass('is-drop-target')
    expect(dataTransfer.dropEffect).toBe('move')
    expect(screen.queryByText('Відпустіть, щоб завантажити на Диск')).not.toBeInTheDocument()
    fireEvent.drop(folderTile, { dataTransfer })

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/drive/documents/doc_one/move',
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(api).not.toHaveBeenCalledWith('/files', expect.anything())
  })

  it('ignores internal drops outside folders while still accepting external file drags', async () => {
    mount()
    const tile = (await screen.findByText('Звіт')).closest('article')!
    const page = tile.closest('.drive-page')!
    const dataTransfer = {
      types: ['application/x-lankadws-drive-item', 'Files'],
      files: [new File(['preview'], 'preview.png', { type: 'image/png' })],
      dropEffect: '',
    }
    fireEvent.dragEnter(page, { dataTransfer })
    fireEvent.dragOver(page, { dataTransfer })
    fireEvent.drop(page, { dataTransfer })
    expect(screen.queryByText('Відпустіть, щоб завантажити на Диск')).not.toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/files', expect.anything())

    const external = { ...dataTransfer, types: ['Files'] }
    fireEvent.dragEnter(page, { dataTransfer: external })
    expect(screen.getByText('Відпустіть, щоб завантажити на Диск')).toBeVisible()
    fireEvent.dragLeave(page, { dataTransfer: external })
    expect(screen.queryByText('Відпустіть, щоб завантажити на Диск')).not.toBeInTheDocument()
  })

  it('starts a canonical Drive drag from an image card with a non-draggable preview', async () => {
    mount()
    const tile = (await screen.findByText('Звіт')).closest('article')!
    const preview = tile.querySelector('img')!
    expect(preview).toHaveAttribute('draggable', 'false')
    const dataTransfer = { clearData: vi.fn(), setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(tile, { dataTransfer })
    expect(dataTransfer.clearData).toHaveBeenCalledOnce()
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-lankadws-drive-item', JSON.stringify({
      kind: 'FILE', id: 'doc_one', version: 3,
    }))
    expect(dataTransfer.effectAllowed).toBe('move')
  })
})
