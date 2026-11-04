import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import OrganizationUniversePage from './OrganizationUniversePage'
import { TopbarContentProvider } from '../layout/TopbarContent'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../shared/api/client', () => ({ api }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'admin', accountType: 'ADMIN', company: { id: 'archived' } } }) }))
vi.mock('../features/organization/OrganizationMap', async (original) => ({
  ...await original<typeof import('../features/organization/OrganizationMap')>(),
  OrganizationMap: ({ sidePanel }: { sidePanel?: React.ReactNode }) => <section>{sidePanel}</section>,
}))
const archived = { id: 'archived', name: 'Архівована', description: null, isActive: false }
const active = { id: 'active', name: 'Активна', description: null, isActive: true }

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function openPage(url = '/organization?companyId=archived&orgUnit=old&manager=old&unitId=old&employeeId=old') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>
      <TopbarContentProvider><OrganizationUniversePage /><Location /></TopbarContentProvider>
    </MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => {
  api.mockReset().mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [archived, active] }
    if (path.startsWith('/org/units')) return { company: active, items: [] }
    if (path.startsWith('/employees')) return { items: [], counts: { all: 0, available: 0, away: 0 }, filters: { orgUnits: [], managers: [] } }
    return { items: [] }
  })
})

it('replaces an archived company URL before requesting directory data and clears old selections', async () => {
  openPage()
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?companyId=active'))
  expect(screen.getByTestId('location').textContent).toBe('?companyId=active')
  await waitFor(() => expect(api).toHaveBeenCalledWith('/employees?company=active'))
  expect(screen.queryByRole('option', { name: 'Архівована' })).not.toBeInTheDocument()
  expect(api.mock.calls.some(([path]) => path.includes('company=archived'))).toBe(false)
})

it.each([
  ['the whole company', '', 'Уся компанія', 'Усього працівників: 2'],
  ['a department', '&orgUnit=unit_one', 'IT', 'Працівників у підрозділі: 2'],
  ['a search', '&q=Анна', 'Уся компанія', 'Знайдено: 2'],
])('labels the directory count for %s', async (_scope, filters, title, count) => {
  api.mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [active] }
    if (path.startsWith('/org/units')) return { company: active, items: [{ id: 'unit_one', companyId: active.id, parentId: null, name: 'IT', description: null, manager: null, activeEmployeeCount: 2, childCount: 0, sortOrder: 0, version: 1 }] }
    return { items: [{ id: 'one', displayName: 'Анна Бойко', jobTitle: 'QA', avatarAsset: null, presence: 'AVAILABLE' }, { id: 'two', displayName: 'Анна Гнатюк', jobTitle: 'QA', avatarAsset: null, presence: 'AVAILABLE' }], total: 2, nextCursor: null, counts: { all: 2, available: 2, away: 0 }, filters: { orgUnits: [], managers: [] } }
  })
  openPage(`/organization?companyId=active${filters}`)
  expect(await screen.findByRole('heading', { level: 2, name: title })).toBeInTheDocument()
  await waitFor(() => expect(document.querySelector('.directory-people-count')).toHaveTextContent(count))
})

it('shows restoration when all companies are archived without making forbidden requests', async () => {
  api.mockImplementation(async () => ({ items: [archived] }))
  openPage()
  expect(await screen.findByText('Усі компанії архівовані')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Відновити: Архівована' })).toHaveAttribute('href', '/admin/companies/archived/structure')
  expect(api.mock.calls.every(([path]) => path === '/companies')).toBe(true)
})

function openUrl(url: string) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>
      <TopbarContentProvider><OrganizationUniversePage /><Location /></TopbarContentProvider>
    </MemoryRouter>
  </QueryClientProvider>)
}

const person = (id: string, displayName: string) => ({ id, displayName, jobTitle: 'Роль', avatarAsset: null, presence: 'AVAILABLE', timezone: 'UTC', orgUnit: null })

function mockDirectory() {
  api.mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [active] }
    if (path.startsWith('/org/units')) return { company: active, items: [] }
    const page = new URLSearchParams(path.split('?')[1]).get('cursor')
    return {
      items: [page === 'first' ? person('second', 'Друга Сторінка') : page === 'second' ? person('third', 'Третя Сторінка') : person('first', 'Перша Сторінка')],
      total: 41,
      nextCursor: page === 'second' ? null : page === 'first' ? 'second' : 'first',
      counts: { all: 41, available: 41, away: 0 }, filters: { orgUnits: [], managers: [] },
    }
  })
}

it('pages the directory through the URL and counts the whole filtered set', async () => {
  mockDirectory()
  openUrl('/organization?companyId=active&presence=AWAY')
  await screen.findByText('Перша Сторінка')
  expect(document.querySelector('.directory-people-count')).toHaveTextContent('Знайдено: 41')
  expect(screen.getByRole('button', { name: 'Назад' })).toHaveAttribute('aria-disabled', 'true')

  fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
  await screen.findByText('Друга Сторінка')
  expect(api).toHaveBeenCalledWith('/employees?company=active&presence=AWAY&cursor=first')
  expect(screen.getByTestId('location').textContent).toBe('?companyId=active&presence=AWAY&cursor=first')
  expect(document.querySelector('.directory-people-count')).toHaveTextContent('Знайдено: 41')

  fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
  await screen.findByText('Третя Сторінка')
  expect(screen.getByRole('button', { name: 'Далі' })).toHaveAttribute('aria-disabled', 'true')

  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByText('Друга Сторінка')
  expect(screen.getByTestId('location').textContent).toBe('?companyId=active&presence=AWAY&cursor=first')
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByText('Перша Сторінка')
  expect(screen.getByTestId('location').textContent).toBe('?companyId=active&presence=AWAY')
})

it('keeps the page when opening a person and leaves it when a filter changes', async () => {
  mockDirectory()
  openUrl('/organization?companyId=active&cursor=first')
  fireEvent.click((await screen.findByText('Друга Сторінка')).closest('button')!)
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?companyId=active&cursor=first&employeeId=second'))
  fireEvent.change(screen.getByLabelText('Доступність'), { target: { value: 'AWAY' } })
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?companyId=active&employeeId=second&presence=AWAY'))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/employees?company=active&presence=AWAY'))
})

it('opens a shared page link directly and returns to the first page from it', async () => {
  mockDirectory()
  openUrl('/organization?companyId=active&cursor=second')
  await screen.findByText('Третя Сторінка')
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByText('Перша Сторінка')
  expect(screen.getByTestId('location').textContent).toBe('?companyId=active')
})

it('explains an empty page past the end instead of claiming nobody was found', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [active] }
    if (path.startsWith('/org/units')) return { company: active, items: [] }
    return { items: [], total: 41, nextCursor: null, counts: { all: 41, available: 41, away: 0 }, filters: { orgUnits: [], managers: [] } }
  })
  openUrl('/organization?companyId=active&cursor=gone')
  expect(await screen.findByText('На цій сторінці більше немає працівників.')).toBeInTheDocument()
  expect(screen.queryByText('Нікого не знайдено')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Назад' })).toHaveAttribute('aria-disabled', 'false')
})

it('pages the unit panel without the manager and resets when the unit changes', async () => {
  const unit = (id: string, name: string) => ({ id, companyId: active.id, parentId: null, name, description: null, manager: { id: 'manager', displayName: 'Андрій Коваль', jobTitle: '', avatarAsset: null }, activeEmployeeCount: 25, childCount: 0, sortOrder: 0, version: 1 })
  api.mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [active] }
    if (path.includes('/employees')) {
      return path.includes('cursor=first')
        ? { items: [person('second', 'Друга Сторінка')], total: 21, nextCursor: null }
        : { items: [person('first', 'Перша Сторінка')], total: 21, nextCursor: 'first' }
    }
    return { company: active, items: [unit('unit_one', 'IT'), unit('unit_two', 'HR')] }
  })
  openUrl('/organization?companyId=active&view=structure&unitId=unit_one')
  await screen.findByText('Перша Сторінка')
  expect(api).toHaveBeenCalledWith('/org/units/unit_one/employees?company=active&excludeManager=true')
  fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
  await screen.findByText('Друга Сторінка')
  expect(api).toHaveBeenCalledWith('/org/units/unit_one/employees?company=active&excludeManager=true&cursor=first')
  expect(screen.getByRole('button', { name: 'Далі' })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByText('Перша Сторінка')
})

it('shows the department manager with their avatar and job title', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [active] }
    if (path.includes('/employees')) return { items: [] }
    return { company: active, items: [{ id: 'unit_one', companyId: active.id, parentId: null, name: 'IT', description: null, manager: { id: 'manager', displayName: 'Андрій Коваль', jobTitle: 'Операційний керівник', avatarAsset: 'file_avatar_manager' }, activeEmployeeCount: 0, childCount: 0, sortOrder: 0, version: 1 }] }
  })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/organization?companyId=active&view=structure&unitId=unit_one']}>
      <TopbarContentProvider><OrganizationUniversePage /><Location /></TopbarContentProvider>
    </MemoryRouter>
  </QueryClientProvider>)
  const manager = await screen.findByRole('button', { name: /Андрій Коваль/ })
  expect(manager).toHaveTextContent('Керівник · Операційний керівник')
  expect(manager.querySelector('img')).toHaveAttribute('src', '/api/v1/me/avatar/file_avatar_manager')
  const stats = screen.getByLabelText('Показники підрозділу')
  expect(stats.closest('header')).toHaveTextContent('IT')
  expect(stats.querySelectorAll('dt')[0]).toHaveTextContent('Працівники')
  expect(stats.querySelectorAll('dt')[1]).toHaveTextContent('Підрозділи')
  expect(stats.querySelectorAll('dd')[0]).toHaveTextContent('0')
  expect(stats.querySelectorAll('dd')[1]).toHaveTextContent('0')
})

it('lists an assigned manager once and says when nobody else is in the department', async () => {
  const manager = { id: 'manager', displayName: 'Андрій Коваль', jobTitle: 'Керівник', avatarAsset: null }
  api.mockImplementation(async (path: string) => {
    if (path === '/companies') return { items: [active] }
    if (path.includes('/employees')) return path.includes('excludeManager=true') ? { items: [], total: 0, nextCursor: null } : { items: [manager], total: 1, nextCursor: null }
    return { company: active, items: [{ id: 'unit_one', companyId: active.id, parentId: null, name: 'IT', description: null, manager, activeEmployeeCount: 1, childCount: 0, sortOrder: 0, version: 1 }] }
  })
  openPage('/organization?companyId=active&view=structure&unitId=unit_one')
  expect(await screen.findByText('Інших працівників немає.')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Андрій Коваль/ })).toHaveLength(1)
})
