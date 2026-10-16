import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import ContentPages from './ContentPages'
import { TopbarContentProvider } from '../layout/TopbarContent'
import { OverlayProvider } from '../shared/ui/Overlay'

const { request, principal } = vi.hoisted(() => ({ request: vi.fn(), principal: { id: 'user', accountType: 'USER' } }))
vi.mock('../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: principal }) }))
afterEach(() => { cleanup(); request.mockReset(); principal.accountType = 'USER'; vi.unstubAllGlobals() })

it('opens an article directly as a page, renders formatting and confirms reading', async () => {
  request.mockImplementation(async (path: string) => path.endsWith('/acknowledge') ? {} : {
    id: 'article', slug: 'guide', createdAt: '2026-10-05T09:00:00Z', requiresAcknowledgement: true, version: 3, companyIds: ['company'], attachments: [{ id: 'image', safeFilename: 'guide.png', bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN' }], acknowledgement: null,
    currentVersion: { title: 'Інструкція', body: '**Важливий текст**', publishedAt: '2026-10-06T09:00:00Z', changeSummary: '' },
  })
  const router = createMemoryRouter([{ path: '/knowledge/:articleSlug', element: <ContentPages /> }], { initialEntries: ['/knowledge/guide'] })
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByRole('heading', { name: 'Інструкція', level: 1 })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(container.querySelector('article strong')).toHaveTextContent('Важливий текст')
  expect(container.querySelector('.knowledge-reading-image')).toHaveAttribute('src', '/api/v1/files/image/download?inline=true')
  expect(screen.queryByRole('heading', { name: 'Прикріплені файли' })).toBeNull()
  expect(screen.queryByText('guide.png')).toBeNull()
  expect(screen.getByRole('link', { name: /База знань/ })).toHaveAttribute('href', '/knowledge')
  expect(request.mock.calls.some(([path]) => path.startsWith('/knowledge/articles?'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Ознайомився' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/knowledge/articles/guide/acknowledge', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 3 }) })))
})

it('publishes formatting from the knowledge creation form and keeps its company audience', async () => {
  principal.accountType = 'ADMIN'
  request.mockImplementation(async (path: string) => path === '/admin/companies'
    ? { items: [{ id: 'company', name: 'Компанія', isActive: true }] }
    : { items: [] })
  const router = createMemoryRouter([{ path: '/knowledge', element: <OverlayProvider><TopbarContentProvider><ContentPages /></TopbarContentProvider></OverlayProvider> }], { initialEntries: ['/knowledge?manage=1&edit=new'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  const body = await screen.findByRole('textbox', { name: 'Текст матеріалу' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Назва' }), { target: { value: 'Нова інструкція' } })
  body.innerHTML = '<p><strong>Крок один</strong></p>'
  fireEvent.input(body)
  expect(body.querySelector('strong')).toHaveTextContent('Крок один')
  expect(screen.queryByRole('button', { name: 'Перегляд' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Ознайомлення' }), { target: { value: 'required' } })
  fireEvent.click(screen.getByRole('button', { name: 'Опублікувати матеріал' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/knowledge/articles', expect.objectContaining({ method: 'POST', body: expect.any(String) })))
  const submitted = request.mock.calls.find(([path, options]) => path === '/knowledge/articles' && options?.method === 'POST')!
  expect(JSON.parse(submitted[1].body)).toMatchObject({ title: 'Нова інструкція', body: '**Крок один**', companyIds: ['company'], requiresAcknowledgement: true })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('shows the article image in the list and falls back when it cannot load', async () => {
  request.mockResolvedValue({ items: [{ id: 'article', slug: 'guide', title: 'Інструкція', createdAt: '2026-10-05', requiresAcknowledgement: true, version: 1, updatedAt: '2026-10-06', imageFileId: 'image' }] })
  const router = createMemoryRouter([{ path: '/knowledge', element: <TopbarContentProvider><ContentPages /></TopbarContentProvider> }], { initialEntries: ['/knowledge'] })
  const { container } = render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'Інструкція' })
  expect(screen.getByText(/Створено/)).toBeInTheDocument()
  expect(screen.queryByText(/Оновлено|версія|Оновлено матеріал/)).toBeNull()
  expect(screen.getByRole('img', { name: 'Обов’язкове ознайомлення' })).toBeInTheDocument()
  expect(screen.getByText('Не ознайомлено')).toHaveClass('is-pending')
  const image = container.querySelector('.knowledge-article-image')!
  expect(image).toHaveAttribute('src', '/api/v1/files/image/download?inline=true')
  fireEvent.error(image)
  expect(container.querySelector('.knowledge-article-image')).toBeNull()
  expect(container.querySelector('.knowledge-article-card .article-icon')).toBeInTheDocument()
})

it('shows the current user confirmed status on the article card', async () => {
  request.mockResolvedValue({ items: [{ id: 'article', slug: 'guide', title: 'Інструкція', createdAt: '2026-10-05', requiresAcknowledgement: false, hasAcknowledged: true, version: 1 }] })
  const router = createMemoryRouter([{ path: '/knowledge', element: <TopbarContentProvider><ContentPages /></TopbarContentProvider> }], { initialEntries: ['/knowledge'] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByText('Ознайомлено')).toHaveClass('is-confirmed')
  expect(screen.queryByText('Не ознайомлено')).toBeNull()
  expect(screen.getByText(/Створено/)).toHaveClass('knowledge-article-created')
})

it('updates a cached preview and refreshes the next step when confirming and returning to the list', async () => {
  let confirmed = false
  const createdAt = '2026-10-05T09:00:00Z'
  const article = { id: 'article', slug: 'guide', title: 'Інструкція', createdAt, requiresAcknowledgement: true, version: 3 }
  request.mockImplementation(async (path: string) => {
    if (path.endsWith('/acknowledge')) {
      confirmed = true
      return { confirmed: true, confirmedAt: createdAt }
    }
    if (path.startsWith('/knowledge/articles?')) return { items: [{ ...article, hasAcknowledged: confirmed }] }
    if (path === '/dashboard') return { focus: { nextStep: confirmed ? { kind: 'TASK', href: '/tasks/task' } : { kind: 'KNOWLEDGE', href: '/knowledge/guide' } } }
    return { ...article, companyIds: ['company'], attachments: [], acknowledgement: confirmed ? { confirmedAt: createdAt } : null, currentVersion: { title: article.title, body: 'Текст', publishedAt: createdAt, changeSummary: '' } }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  await client.fetchQuery({ queryKey: ['dashboard'], queryFn: () => request('/dashboard') })
  const router = createMemoryRouter([
    { path: '/knowledge', element: <TopbarContentProvider><ContentPages /></TopbarContentProvider> },
    { path: '/knowledge/:articleSlug', element: <TopbarContentProvider><ContentPages /></TopbarContentProvider> },
  ], { initialEntries: ['/knowledge'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByText('Не ознайомлено')).toHaveClass('is-pending')
  expect(screen.getByRole('img', { name: 'Обов’язкове ознайомлення' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: /Інструкція Не ознайомлено/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ознайомився' }))
  expect(await screen.findByText(/Ви ознайомилися/)).toBeInTheDocument()
  await waitFor(() => expect(client.getQueryData(['dashboard'])).toMatchObject({ focus: { nextStep: { kind: 'TASK', href: '/tasks/task' } } }))
  fireEvent.click(screen.getByRole('link', { name: '← База знань' }))
  expect(await screen.findByText('Ознайомлено')).toHaveClass('is-confirmed')
  expect(screen.queryByText('Не ознайомлено')).toBeNull()
  expect(screen.queryByRole('img', { name: 'Обов’язкове ознайомлення' })).toBeNull()
  expect(screen.getByRole('link', { name: /Інструкція Ознайомлено/ }).parentElement).not.toHaveClass('is-required')
})

it('uploads a selected image and attaches it when publishing', async () => {
  principal.accountType = 'ADMIN'
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:preview')
    static revokeObjectURL = vi.fn()
  })
  request.mockImplementation(async (path: string) => path === '/admin/companies'
    ? { items: [{ id: 'company', name: 'Компанія', isActive: true }] }
    : path.startsWith('/files?') ? { id: 'image', scanStatus: 'CLEAN' } : { items: [] })
  const router = createMemoryRouter([{ path: '/knowledge', element: <OverlayProvider><TopbarContentProvider><ContentPages /></TopbarContentProvider></OverlayProvider> }], { initialEntries: ['/knowledge?manage=1&edit=new'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  const body = await screen.findByRole('textbox', { name: 'Текст матеріалу' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Назва' }), { target: { value: 'Інструкція' } })
  body.innerHTML = '<p>Текст</p>'
  fireEvent.input(body)
  const file = new File(['image'], 'guide.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Додати картинку'), { target: { files: [file] } })
  expect(await screen.findByAltText('Вибрана картинка запису')).toHaveAttribute('src', 'blob:preview')
  expect(screen.queryByLabelText('Додати картинку')).toBeNull()
  expect(screen.getByText('Картинку вибрано · 1 з 1')).toBeInTheDocument()
  expect(screen.getByLabelText('Замінити картинку')).not.toHaveAttribute('multiple')
  const replacement = new File(['new-image'], 'replacement.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Замінити картинку'), { target: { files: [replacement] } })
  expect(screen.queryByText('guide.png')).toBeNull()
  expect(screen.getByText('replacement.png')).toBeInTheDocument()
  expect(screen.getAllByAltText('Вибрана картинка запису')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Опублікувати матеріал' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/knowledge/articles', expect.objectContaining({ method: 'POST' })))
  const upload = request.mock.calls.find(([path]) => path.startsWith('/files?'))!
  expect(upload[1].body.get('file')).toBe(replacement)
  expect(request.mock.calls.filter(([path]) => path.startsWith('/files?'))).toHaveLength(1)
  const submitted = request.mock.calls.find(([path, options]) => path === '/knowledge/articles' && options?.method === 'POST')!
  expect(JSON.parse(submitted[1].body).attachmentIds).toEqual(['image'])
})

it('removes saved cover and attachments from the edit draft and submits selected removals', async () => {
  principal.accountType = 'ADMIN'
  const article = {
    id: 'article', slug: 'guide', version: 3, createdAt: '2026-10-05', requiresAcknowledgement: false, companyIds: ['company'], acknowledgement: null,
    currentVersion: { title: 'Інструкція', body: 'Текст', changeSummary: '', publishedAt: '2026-10-05' },
    attachments: [{ id: 'cover', safeFilename: 'cover.png', bytes: 10, mimeType: 'image/png', scanStatus: 'CLEAN' }, { id: 'file', safeFilename: 'guide.pdf', bytes: 10, mimeType: 'application/pdf', scanStatus: 'CLEAN' }],
  }
  request.mockImplementation(async (path: string) => path === '/admin/companies' ? { items: [{ id: 'company', name: 'Компанія', isActive: true }] } : path === '/knowledge/articles/guide' ? article : { items: [] })
  const router = createMemoryRouter([{ path: '/knowledge', element: <OverlayProvider><TopbarContentProvider><ContentPages /></TopbarContentProvider></OverlayProvider> }], { initialEntries: ['/knowledge?manage=1&edit=guide'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByText('cover.png')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Прибрати картинку' }))
  expect(screen.queryByText('cover.png')).toBeNull()
  expect(screen.getByLabelText('Додати картинку')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Прибрати guide.pdf' }))
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(0)
  expect(router.state.location.search).toContain('edit=guide')
  await waitFor(() => expect(screen.queryByText('guide.pdf')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/knowledge/articles/guide', expect.objectContaining({ method: 'PATCH' })))
  const submitted = request.mock.calls.find(([path, options]) => path === '/knowledge/articles/guide' && options?.method === 'PATCH')!
  expect(JSON.parse(submitted[1].body)).toMatchObject({ removedAttachmentIds: ['cover', 'file'], attachmentIds: [], expectedVersion: 3 })
})
