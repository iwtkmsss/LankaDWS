import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../shared/api/client'
import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'
import ContentPages from './ContentPages'
import { OverlayProvider } from '../shared/ui/Overlay'

const auth = vi.hoisted(() => ({ accountType: 'ADMIN' }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: auth }) }))
vi.mock('../shared/api/client', async (original) => ({ ...await original<typeof import('../shared/api/client')>(), api: vi.fn() }))
const item = { id: 'article', slug: 'policy', title: 'Політика', changeSummary: 'Перша публікація', version: 2, updatedAt: '2026-09-04' }

function mount(path = '/knowledge') {
  const router = createMemoryRouter([{ path: '/knowledge/:articleSlug?', element: <OverlayProvider><TopbarContentProvider><TopbarContent /><ContentPages /></TopbarContentProvider></OverlayProvider> }], { initialEntries: [path] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
}

beforeEach(() => {
  auth.accountType = 'ADMIN'
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path.startsWith('/files?')) return { id: 'file_new', scanStatus: 'CLEAN' }
    if (path === '/files/file_new/status') return { scanStatus: 'CLEAN' }
    if (options?.method) return { id: 'article', slug: 'policy' }
    if (path.startsWith('/knowledge/articles?')) return { items: [item] }
    if (path === '/knowledge/articles/policy') return { ...item, currentVersion: { title: 'Політика', body: 'Чинний текст', publishedAt: '2026-09-04T10:00:00.000Z' }, attachments: [{ id: 'file_image', safeFilename: 'guide.jpg', bytes: 1024, mimeType: 'image/jpeg', scanStatus: 'CLEAN' }] }
    if (path === '/admin/companies') return { items: [{ id: 'company', isActive: true }] }
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('knowledge management', () => {
  it('toggles editing controls on the knowledge page', async () => {
    mount()
    await screen.findByText('Політика')
    expect(screen.queryByRole('button', { name: /Додати матеріал/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Керувати матеріалами' }))
    expect(screen.getByRole('button', { name: 'Редагувати Політика' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Додати матеріал/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Завершити керування' }))
    expect(screen.queryByRole('button', { name: 'Редагувати Політика' })).not.toBeInTheDocument()
  })
  it('loads existing text and submits a version-checked update', async () => {
    mount('/knowledge?manage=1&edit=policy')
    const body = await screen.findByLabelText('Текст матеріалу')
    expect(body).toHaveValue('Чинний текст')
    fireEvent.change(body, { target: { value: 'Новий текст' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/knowledge/articles/policy', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Політика', body: 'Новий текст', changeSummary: '', attachmentIds: [], expectedVersion: 2 }) })))
    await waitFor(() => expect(screen.queryByLabelText('Текст матеріалу')).not.toBeInTheDocument())
  })
  it('creates a material using the existing publication endpoint', async () => {
    mount('/knowledge?manage=1&edit=new')
    fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'Інструкція' } })
    fireEvent.change(screen.getByLabelText('Текст матеріалу'), { target: { value: 'Зміст' } })
    fireEvent.click(screen.getByRole('button', { name: 'Опублікувати матеріал' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/knowledge/articles', expect.objectContaining({ method: 'POST' })))
    const call = vi.mocked(api).mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ title: 'Інструкція', body: 'Зміст', companyIds: ['company'] })
    await waitFor(() => expect(screen.queryByLabelText('Текст матеріалу')).not.toBeInTheDocument())
  })
  it('uploads selected files before attaching them to a new material', async () => {
    mount('/knowledge?manage=1&edit=new')
    fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'Інструкція' } })
    fireEvent.change(screen.getByLabelText('Текст матеріалу'), { target: { value: 'Зміст' } })
    fireEvent.change(screen.getByLabelText('Додати файли'), { target: { files: [new File(['content'], 'guide.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Опублікувати матеріал' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/files?company=company', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/knowledge/articles', expect.objectContaining({ body: expect.stringContaining('"attachmentIds":["file_new"]') })))
  })
  it('hides management for ordinary users even with management URL parameters', async () => {
    auth.accountType = 'USER'
    mount('/knowledge?manage=1&edit=policy')
    await screen.findByText('Політика')
    expect(screen.queryByRole('button', { name: /Керувати|Редагувати|Додати матеріал/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Текст матеріалу')).not.toBeInTheDocument()
  })
  it('asks for confirmation and archives a material', async () => {
    mount('/knowledge?manage=1')
    fireEvent.click(await screen.findByRole('button', { name: 'Видалити Політика' }))
    expect(screen.getByRole('alertdialog', { name: 'Видалити матеріал?' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/knowledge/articles/policy', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ expectedVersion: 2 }) })))
  })
  it('shows an inline image preview for an attached file', async () => {
    mount('/knowledge/policy')
    const preview = await screen.findByRole('region', { name: 'Прикріплений файл guide.jpg' })
    expect(screen.getByRole('img', { name: 'guide.jpg' })).toHaveAttribute('src', '/api/v1/files/file_image/download?inline=true')
    expect(preview).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Згорнути передперегляд guide.jpg' }))
    expect(screen.queryByRole('img', { name: 'guide.jpg' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути guide.jpg' }))
    expect(screen.getByRole('img', { name: 'guide.jpg' })).toBeVisible()
  })
})
