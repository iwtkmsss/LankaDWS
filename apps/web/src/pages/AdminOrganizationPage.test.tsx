import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import { beforeEach, expect, it, vi } from 'vitest'

import AdminOrganizationPage from './AdminOrganizationPage'
import OrganizationUniversePage from './OrganizationUniversePage'

import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'

import { OverlayProvider } from '../shared/ui/Overlay'



const { api } = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock('../shared/api/client', () => ({ api, jsonBody: JSON.stringify }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'admin', accountType: 'ADMIN', company: { id: 'cmp_test' } } }) }))

vi.mock('../features/organization/OrganizationMap', () => ({

  OrganizationMap: ({ sidePanel, onSelectCompany, onSelect, onBackgroundClick }: { sidePanel?: React.ReactNode; onSelectCompany: () => void; onSelect: (id: string) => void; onBackgroundClick: () => void }) => <><button className="organization-map__node" onClick={onSelectCompany}>Вибрати компанію</button><button className="organization-map__node" onClick={() => onSelect('root')}>Вибрати підрозділ</button><button onClick={onBackgroundClick}>Порожнє місце карти</button><div className="organization-map__panel">{sidePanel}</div></>,

}))



const initial = { id: 'cmp_test', name: 'Компанія', slug: 'company', description: '', timezone: 'Europe/Kyiv', isActive: true, version: 1, manager: null, counts: { users: 7, units: 3 } }

let company = { ...initial }

const rootUnit = { id: 'root', companyId: initial.id, name: 'Операції', description: null, parentId: null, status: 'ACTIVE', sortOrder: 0, version: 1, manager: null, activeEmployeeCount: 2, childCount: 1 }

let units = [rootUnit, { ...rootUnit, id: 'child', name: 'Дизайн', parentId: 'root', childCount: 0 }, { ...rootUnit, id: 'target', name: 'Інший відділ', childCount: 0 }]



beforeEach(() => {

  company = { ...initial }

  units = [rootUnit, { ...rootUnit, id: 'child', name: 'Дизайн', parentId: 'root', childCount: 0 }, { ...rootUnit, id: 'target', name: 'Інший відділ', childCount: 0 }]

  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

  api.mockReset().mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {

    if (path.endsWith('/deactivate')) { company = { ...company, isActive: false }; return company }

    if (path.endsWith('/activate')) { company = { ...company, isActive: true }; return company }

    if (options?.method === 'PATCH' && path.includes('/org-units/')) {

      units = units.map((unit) => path.endsWith(`/${unit.id}`) ? { ...unit, ...JSON.parse(options.body!), version: unit.version + 1 } : unit)

      return units.find((unit) => path.endsWith(`/${unit.id}`))

    }

    if (options?.method === 'PATCH') { company = { ...company, ...JSON.parse(options.body!), version: company.version + 1 }; return company }

    if (path.endsWith('/archive')) {

      const input = JSON.parse(options!.body!)

      units = units.map((unit) => unit.id === 'root' || (input.archiveBranch && unit.id === 'child') ? { ...unit, status: 'ARCHIVED', version: unit.version + 1 } : unit)

      return { archived: true }

    }

    if (path.startsWith('/org/units/') && path.includes('/employees')) return { items: [{ id: 'employee', displayName: 'Марія Іваненко', jobTitle: 'Дизайнерка', avatarAsset: null }] }
    if (path.includes('/org-units') || path.startsWith('/org/units?')) return { company, items: units }

    if (path === '/companies') return { items: [company] }

    if (path === '/admin/companies/cmp_test') return company

    return { items: [] }

  })

})



it('edits a department in the map panel and closes selected entities on background click', async () => {

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Вибрати підрозділ' }))

  expect(screen.queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument()

  const name = screen.getByLabelText('Назва')

  expect(name.closest('.organization-map__panel')).not.toBeNull()

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.change(name, { target: { value: 'Нові операції' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Ваги' }))

  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))

  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies/cmp_test/org-units/root', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('Нові операції') })))

  await screen.findByDisplayValue('Нові операції')
  expect(screen.getByRole('radio', { name: 'Ваги' })).toBeChecked()
  expect(api.mock.calls.some(([, options]) => options?.body && JSON.parse(options.body).icon === 'scales')).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Порожнє місце карти' }))

  expect(screen.queryByLabelText('Назва')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Вибрати компанію' }))

  await screen.findByLabelText('Назва')

  fireEvent.click(screen.getByRole('button', { name: 'Порожнє місце карти' }))

  expect(screen.queryByLabelText(/Slug/)).not.toBeInTheDocument()

})

it('keeps an archived parent selected instead of silently restoring a child at company level', async () => {
  units = units.map((unit) => ({ ...unit, status: 'ARCHIVED' }))
  openSettings('/admin/companies/cmp_test/structure?unit=child')
  const parent = await screen.findByLabelText('Батьківський підрозділ')
  expect(parent).toHaveValue('root')
  fireEvent.click(screen.getByRole('button', { name: 'Відновити структуру' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies/cmp_test/org-units/child/restore', expect.objectContaining({ body: expect.stringContaining('"parentId":"root"') })))
})

it('shows the company holding area separately from company settings', async () => {
  openSettings()
  fireEvent.click(await screen.findByRole('button', { name: 'Не у підрозділі' }))
  expect(await screen.findByRole('region', { name: 'Працівники без підрозділу' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Опис')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Вибрати компанію' }))
  expect(await screen.findByLabelText('Опис')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Працівники без підрозділу' })).not.toBeInTheDocument()
})



it('opens new department and company forms in the small panel and dismisses them', async () => {

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Новий підрозділ' }))

  expect(screen.getByLabelText('Назва').closest('.organization-map__panel')).not.toBeNull()

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Порожнє місце карти' }))

  expect(screen.queryByLabelText('Назва')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Нова компанія' }))

  expect(screen.getByLabelText('Назва').closest('.organization-map__panel')).not.toBeNull()

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Закрити панель' }))

  expect(screen.queryByLabelText('Назва')).not.toBeInTheDocument()

})



function SettingsLocation() {
  const location = useLocation()
  return <output data-testid="settings-location">{location.pathname}{location.search}</output>
}

it('returns to the selected department with its employees after finishing editing', async () => {
  openSettings('/organization?companyId=cmp_test&view=structure&unitId=root')
  expect(await screen.findByRole('button', { name: /Марія Іваненко/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Редагувати структуру' }))
  expect(screen.getByTestId('settings-location')).toHaveTextContent('/admin/companies/cmp_test/structure?unit=root')
  await screen.findByLabelText('Назва')
  fireEvent.click(screen.getByRole('button', { name: 'Завершити редагування' }))
  expect(screen.getByTestId('settings-location')).toHaveTextContent('/organization?companyId=cmp_test&view=structure&unitId=root')
  expect(screen.getByTestId('settings-location').textContent).not.toContain('editing=1')
  expect(await screen.findByRole('button', { name: /Марія Іваненко/ })).toBeInTheDocument()
  expect(screen.queryByLabelText('Назва')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Редагувати структуру' }))
  await screen.findByLabelText('Назва')
})

it('returns to the structure without selecting a department when no department is selected', async () => {
  openSettings()
  await screen.findByRole('button', { name: 'Новий підрозділ' })
  fireEvent.click(screen.getByRole('button', { name: 'Завершити редагування' }))
  expect(screen.getByTestId('settings-location').textContent).toBe('/organization?companyId=cmp_test&view=structure')
  await screen.findByRole('region', { name: 'Структура організації' })
})

it.each(['', '&editing=0', '&editing=1'])('always opens the admin route as an editor and removes the obsolete flag (%s)', async (legacyFlag) => {
  openSettings(`/admin/companies/cmp_test/structure?unit=root&marker=keep${legacyFlag}`)
  await screen.findByLabelText('Назва')
  expect(screen.getByTestId('settings-location').textContent).toBe('/admin/companies/cmp_test/structure?unit=root&marker=keep')
  expect(screen.getByRole('button', { name: 'Новий підрозділ' })).toBeInTheDocument()
  expect(screen.queryByText(/Увімкніть редагування/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Вибрати компанію' }))
  await screen.findByLabelText('Назва')
  expect(screen.queryByText(/Увімкніть редагування/)).not.toBeInTheDocument()
})

function openSettings(path = '/admin/companies/cmp_test/structure') {

  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>

    <MemoryRouter initialEntries={[path]}>

      <TopbarContentProvider><OverlayProvider>
        <TopbarContent /><SettingsLocation />

        <Routes><Route path="/admin/companies/:companyId/structure" element={<AdminOrganizationPage />} /><Route path="/organization" element={<OrganizationUniversePage />} /></Routes>

      </OverlayProvider></TopbarContentProvider>

    </MemoryRouter>

  </QueryClientProvider>)

}



it('saves company details without exposing or changing advanced settings', async () => {
  openSettings()
  fireEvent.click(await screen.findByRole('button', { name: 'Вибрати компанію' }))
  const name = await screen.findByLabelText('Назва')
  expect(screen.queryByText('Додаткові параметри')).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Slug/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Часовий пояс')).not.toBeInTheDocument()
  const originalSlug = company.slug
  const originalTimezone = company.timezone
  fireEvent.change(name, { target: { value: 'Нова назва' } })
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies/cmp_test', expect.objectContaining({ method: 'PATCH' })))
  const patch = api.mock.calls.find(([path, options]) => path === '/admin/companies/cmp_test' && options?.method === 'PATCH')
  expect(JSON.parse(patch![1]!.body!)).toMatchObject({ slug: originalSlug, timezone: originalTimezone })
  expect(company).toMatchObject({ name: 'Нова назва', slug: originalSlug, timezone: originalTimezone })
})

it('confirms archival, keeps the company selectable and restores it', async () => {

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Вибрати компанію' }))

  await screen.findByLabelText('Назва')
  expect(document.querySelector('.admin-org-stats')).toBeNull()
  expect(screen.queryByText('Назва, опис, керівник та параметри компанії.')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByText('Архівація'))
  fireEvent.click(await screen.findByRole('button', { name: 'Архівувати компанію' }))

  expect(api.mock.calls.some(([path]) => path.endsWith('/deactivate'))).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }))

  expect(await screen.findByRole('option', { name: 'Компанія · Архівована' })).toBeInTheDocument()

  const archive = await screen.findByRole('region', { name: 'Архів компаній та підрозділів' })

  expect(within(archive).getByRole('button', { name: /Компанія/ })).toBeInTheDocument()

  expect(archive.closest('.organization-map__panel')).not.toBeNull()
  fireEvent.click(within(archive).getByRole('button', { name: /Компанія/ }))
  fireEvent.click(await screen.findByText('Відновлення'))
  fireEvent.click(await screen.findByRole('button', { name: 'Відновити компанію' }))

  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies/cmp_test/activate', { method: 'POST' }))

  expect(await screen.findByText('Архівація')).toBeInTheDocument()

})



it('archives a whole branch after confirmation without a transfer picker', async () => {

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Вибрати підрозділ' }))

  fireEvent.click(screen.getByText('Архівація'))

  expect(screen.queryByLabelText('Куди перенести')).not.toBeInTheDocument()

  expect(screen.getByRole('button', { name: 'Архівувати підрозділ' })).toBeEnabled()

  fireEvent.click(screen.getByRole('radio', { name: /Усю гілку/ }))

  expect(screen.queryByLabelText('Куди перенести')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати всю гілку' }))

  expect(api.mock.calls.some(([path]) => path.endsWith('/archive'))).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }))

  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies/cmp_test/org-units/root/archive', {

    method: 'POST', body: JSON.stringify({ expectedVersion: 1, archiveBranch: true }),

  }))

  fireEvent.click(await screen.findByRole('button', { name: 'Архів (2)' }))

  const archive = screen.getByRole('region', { name: 'Архів компаній та підрозділів' })

  expect(within(archive).getByText('Операції')).toBeInTheDocument()

  expect(within(archive).getByText('Дизайн')).toBeInTheDocument()

  expect(within(archive).queryByText('Інший відділ')).not.toBeInTheDocument()

})



it('archives a single root without a transfer destination', async () => {

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Вибрати підрозділ' }))

  fireEvent.click(screen.getByText('Архівація'))

  expect(screen.queryByLabelText('Куди перенести')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати підрозділ' }))

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }))

  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies/cmp_test/org-units/root/archive', {

    method: 'POST', body: JSON.stringify({ expectedVersion: 1 }),

  }))

})





it('opens the archive in the map panel and dismisses it on background click', async () => {

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Архів (0)' }))

  const archive = screen.getByRole('region', { name: 'Архів компаній та підрозділів' })

  expect(archive.closest('.organization-map__panel')).not.toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Порожнє місце карти' }))

  expect(screen.queryByRole('region', { name: 'Архів компаній та підрозділів' })).not.toBeInTheDocument()

})



it('shows department employees once and retains drag data', async () => {

  const fallback = api.getMockImplementation()!

  api.mockImplementation((path: string, options) => path.startsWith('/org/units/root/employees')

    ? Promise.resolve({ items: [{ id: 'usr_a', displayName: 'Андрій Коваль', positionTitle: 'Керівник', jobTitle: '' }] })

    : fallback(path, options))

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Вибрати підрозділ' }))

  const name = await screen.findByText('Андрій Коваль')

  expect(screen.getAllByText('Андрій Коваль')).toHaveLength(1)

  expect(screen.getByLabelText('Додати працівника')).toBeInTheDocument()

  const setData = vi.fn()

  fireEvent.dragStart(name.closest('article')!, { dataTransfer: { setData } })

  expect(setData).toHaveBeenCalledWith('application/x-lankadws-employee', 'usr_a')

})



it('submits the new company with its manager and selected employees', async () => {

  const fallback = api.getMockImplementation()!

  api.mockImplementation((path: string, options) => path.startsWith('/employees?')

    ? Promise.resolve({ items: [{ id: 'usr_a', displayName: 'Андрій Коваль', jobTitle: 'Керівник' }, { id: 'usr_b', displayName: 'Марія Іваненко', jobTitle: 'Дизайнер' }] })

    : path === '/admin/companies' ? Promise.resolve(company) : fallback(path, options))

  openSettings()

  fireEvent.click(await screen.findByRole('button', { name: 'Нова компанія' }))

  expect(api.mock.calls.some(([path]) => path.startsWith('/employees?') || path.startsWith('/admin/users'))).toBe(false)

  fireEvent.change(screen.getByLabelText('Керівник'), { target: { value: 'Андрій' } })

  fireEvent.mouseDown(await screen.findByRole('option', { name: /Андрій Коваль/ }))

  fireEvent.change(screen.getByLabelText('Додати працівника'), { target: { value: 'Марія' } })

  fireEvent.mouseDown(await screen.findByRole('option', { name: /Марія Іваненко/ }))

  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Нова команда' } })

  fireEvent.change(screen.getByLabelText('Системний slug'), { target: { value: 'new-team' } })

  fireEvent.click(screen.getByRole('button', { name: 'Створити компанію' }))

  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/companies', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"managerId":"usr_a"') })))

  const body = JSON.parse(api.mock.calls.find(([path]) => path === '/admin/companies')![1].body)

  expect(body).toMatchObject({ name: 'Нова команда', slug: 'new-team', timezone: 'Europe/Kyiv', isActive: true, managerId: 'usr_a' })
  expect(body.employeeIds).toEqual(['usr_b'])
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Створити компанію' })).not.toBeInTheDocument())
  expect(screen.getByTestId('settings-location').textContent).toBe('/admin/companies/cmp_test/structure')

})
