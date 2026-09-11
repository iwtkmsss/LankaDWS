import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AdminPages from './AdminPages'
import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'
import { OverlayProvider } from '../shared/ui/Overlay'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../shared/api/client', () => ({ api, jsonBody: JSON.stringify, idempotencyKey: vi.fn() }))

const user = {
  id: 'user-1', displayName: 'Андрій Коваль', firstName: 'Андрій', lastName: 'Коваль',
  middleName: 'Іванович', username: 'andrii', jobTitle: 'Керівник', isActive: true,
  accountType: 'USER', company: { id: 'company-1', name: 'LankaDWS' },
  orgUnit: { id: 'unit-1', name: 'Розробка' }, contactEmail: 'andrii@example.com',
  phone: '+380501234567', gender: 'MALE', birthDate: '1990-05-12',
  leadership: { companies: [], orgUnits: [] },
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.mockReset().mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method) return {}
    if (path === '/admin/users/user-1') return user
    if (path === '/admin/companies') return { items: [{ ...user.company, isActive: true }] }
    if (path.startsWith('/org/units')) return { items: [user.orgUnit] }
    return { items: [user] }
  })
})

function renderUsers() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/users?isActive=true']}>
        <TopbarContentProvider>
        <OverlayProvider>
        <TopbarContent />
        <Routes><Route path="/admin/users/:userId?" element={<AdminPages />} /></Routes>
        </OverlayProvider>
        </TopbarContentProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('opens the full account form from the list and saves profile fields and a photo', async () => {
  renderUsers()
  fireEvent.click(await screen.findByRole('link', { name: /Андрій Коваль/ }))
  expect(await screen.findByLabelText('Ім’я')).toHaveValue('Андрій')
  expect(screen.getByLabelText('Прізвище')).toHaveValue('Коваль')
  expect(screen.getByLabelText('По батькові')).toHaveValue('Іванович')
  expect(screen.getByLabelText('Стать')).toHaveValue('MALE')
  expect(screen.getByLabelText('День народження')).toHaveValue('1990-05-12')
  await waitFor(() => expect(screen.getByLabelText('Підрозділ')).toHaveValue('unit-1'))
  fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+380509876543' } })
  const photo = new File(['image'], 'avatar.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Фотографія'), { target: { files: [photo] } })
  // jsdom does not copy synthetic input files into FormData.
  const get = FormData.prototype.get
  const getSpy = vi.spyOn(FormData.prototype, 'get').mockImplementation(function (this: FormData, name: string) {
    return name === 'photo' ? photo : get.call(this, name)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  getSpy.mockRestore()
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/users/user-1', expect.objectContaining({ method: 'PATCH' })))
  const update = api.mock.calls.find(([, options]) => options?.method === 'PATCH')!
  expect(JSON.parse(update[1].body)).toMatchObject({
    firstName: 'Андрій', lastName: 'Коваль', phone: '+380509876543',
    gender: 'MALE', birthDate: '1990-05-12', orgUnitId: 'unit-1',
  })
  expect(JSON.parse(update[1].body)).not.toHaveProperty('password')
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/users/user-1/avatar', { method: 'POST', body: expect.any(FormData) }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Фільтр за станом')).toHaveValue('true')
})

it('keeps all shared profile fields in the creation form and requires a password', async () => {
  renderUsers()
  fireEvent.click(screen.getByRole('button', { name: 'Додати користувача' }))
  for (const label of ['Ім’я', 'Прізвище', 'По батькові', 'Стать', 'Телефон', 'Email', 'День народження', 'Фотографія']) {
    expect(screen.getByLabelText(label)).toBeInTheDocument()
  }
  expect(screen.getByLabelText('Пароль', { exact: true })).toBeRequired()
  expect(screen.getByLabelText('Підтвердження паролю')).toBeRequired()
})
