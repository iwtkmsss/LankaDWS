import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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

function openPage() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/organization?companyId=archived&orgUnit=old&manager=old&unitId=old&employeeId=old']}>
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

it('shows restoration when all companies are archived without making forbidden requests', async () => {
  api.mockImplementation(async () => ({ items: [archived] }))
  openPage()
  expect(await screen.findByText('Усі компанії архівовані')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Відновити: Архівована' })).toHaveAttribute('href', '/admin/companies/archived/structure')
  expect(api.mock.calls.every(([path]) => path === '/companies')).toBe(true)
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
