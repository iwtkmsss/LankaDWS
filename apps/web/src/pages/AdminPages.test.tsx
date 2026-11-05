import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AdminPages from './AdminPages'
import { TopbarContent, TopbarContentProvider } from '../layout/TopbarContent'
import { OverlayProvider } from '../shared/ui/Overlay'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../shared/api/client', () => ({ api, jsonBody: JSON.stringify, idempotencyKey: vi.fn() }))

const user = {
  id: 'user-1', displayName: 'Андрій Коваль', firstName: 'Андрій', lastName: 'Коваль',
  middleName: 'Іванович', username: 'andrii', jobTitle: 'Керівник', isActive: true,
  accountType: 'USER', company: { id: 'company-1', name: 'Lanka' },
  orgUnit: { id: 'unit-1', name: 'Розробка' }, contactEmail: 'andrii@example.com',
  phone: '+380501234567', gender: 'MALE', birthDate: '1990-05-12',
  leadership: { companies: [], orgUnits: [] },
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.mockReset().mockImplementation(defaultApi)
})

async function defaultApi(path: string, options?: { method?: string }) {
  if (path === '/admin/users' && options?.method === 'POST') return { userId: 'created-user', username: 'new-user' }
  if (options?.method) return {}
  if (path === '/admin/users/user-1') return user
  if (path === '/admin/companies') return { items: [{ ...user.company, isActive: true }] }
  if (path.startsWith('/org/units')) return { items: [user.orgUnit] }
  return { items: [user], total: 1, page: 1, pageSize: 50 }
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Поточний URL">{location.pathname}{location.search}</output>
}

function renderUsers(initialEntry = '/admin/users?isActive=true') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <TopbarContentProvider>
        <OverlayProvider>
        <TopbarContent />
        <LocationProbe />
        <Routes><Route path="/admin/users/:userId?" element={<AdminPages />} /></Routes>
        </OverlayProvider>
        </TopbarContentProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('sorts every column in both directions and preserves sorting through user editing', async () => {
  renderUsers('/admin/users?page=2&search=Коваль&isActive=true')
  await screen.findByRole('link', { name: /Андрій Коваль/ })
  for (const [label, key] of [['Тип / компанія', 'accountType'], ['2FA', 'twoFactor'], ['Статус', 'isActive'], ['Користувач', 'displayName']]) {
    for (const direction of ['asc', 'desc']) {
      fireEvent.click(await screen.findByRole('button', { name: label }))
      await waitFor(() => expect(screen.getByRole('columnheader', { name: label })).toHaveAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending'))
      expect(api.mock.calls.some(([path]) => {
        const query = new URLSearchParams(path.split('?')[1])
        return path.startsWith('/admin/users?') && query.get('sort') === key && query.get('direction') === direction && query.get('page') === '1' && query.get('search') === 'Коваль' && query.get('isActive') === 'true'
      })).toBe(true)
    }
  }
  fireEvent.click(await screen.findByRole('link', { name: /Андрій Коваль/ }))
  await screen.findByRole('dialog', { name: 'Редагувати користувача' })
  expect(screen.getByLabelText('Поточний URL').textContent).toContain('sort=displayName&direction=desc')
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('columnheader', { name: 'Користувач' })).toHaveAttribute('aria-sort', 'descending')
})

it('keeps the same open drawer and focus when loading finishes', async () => {
  let resolveUser: (value: typeof user) => void = () => {}
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/admin/users/user-1' && !options?.method) {
      return new Promise<typeof user>((resolve) => { resolveUser = resolve })
    }
    return defaultApi(path, options)
  })
  renderUsers('/admin/users/user-1')
  const drawer = await screen.findByRole('dialog', { name: 'Редагувати користувача' })
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/users/user-1'))
  expect(screen.queryByLabelText('Ім’я')).not.toBeInTheDocument()
  const focusedElement = document.activeElement
  resolveUser(user)
  expect(await screen.findByLabelText('Ім’я')).toHaveValue('Андрій')
  expect(screen.getByRole('dialog', { name: 'Редагувати користувача' })).toBe(drawer)
  expect(document.activeElement).toBe(focusedElement)
  expect(drawer.isConnected).toBe(true)
})

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

it('restores search and page from the URL and preserves them while opening and closing an account', async () => {
  api.mockImplementation(async (path: string, options?: RequestInit) => path.startsWith('/admin/users?')
    ? { items: [user], total: 151, pageSize: 50 } : defaultApi(path, options))
  renderUsers('/admin/users?search=Коваль&page=3&isActive=true')
  expect(screen.getByRole('textbox', { name: 'Пошук користувачів' })).toHaveValue('Коваль')
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith('/admin/users?') && new URLSearchParams(path.split('?')[1]).get('search') === 'Коваль' && path.includes('page=3'))).toBe(true))
  fireEvent.click(await screen.findByRole('link', { name: /Андрій Коваль/ }))
  await screen.findByLabelText('Ім’я')
  expect(screen.getByLabelText('Поточний URL').textContent).toContain('/admin/users/user-1?search=')
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Поточний URL').textContent).toContain('page=3')
  expect(screen.getByRole('textbox', { name: 'Пошук користувачів' })).toHaveValue('Коваль')
})

it('returns to the last available page when the current page becomes empty', async () => {
  renderUsers('/admin/users?page=2')
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith('/admin/users?') && path.includes('page=1'))).toBe(true))
  expect(screen.getByLabelText('Поточний URL').textContent).toContain('page=1')
})

it('retries a failed edit avatar upload without applying the account update again', async () => {
  let avatarAttempts = 0
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/admin/users/user-1/avatar') {
      if (++avatarAttempts === 1) throw new Error('Фото завелике')
      return {}
    }
    return defaultApi(path, options)
  })
  renderUsers('/admin/users/user-1')
  await waitFor(() => expect(screen.getByLabelText('Підрозділ')).toHaveValue('unit-1'))
  const photo = new File(['image'], 'avatar.png', { type: 'image/png' })
  const get = FormData.prototype.get
  const getSpy = vi.spyOn(FormData.prototype, 'get').mockImplementation(function (this: FormData, name: string) { return name === 'photo' ? photo : get.call(this, name) })
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  getSpy.mockRestore()
  expect(await screen.findByRole('alert')).toHaveTextContent('Зміни збережено, але фото не завантажено')
  expect(screen.getByRole('button', { name: 'Зберегти зміни' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторити завантаження фото' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(avatarAttempts).toBe(2)
  expect(api.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
})

it('debounces search, cancels the previous request and resets pagination', async () => {
  let firstSignal: AbortSignal | undefined
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.startsWith('/admin/users?') && path.includes('search=&')) {
      firstSignal = options?.signal as AbortSignal
      return new Promise(() => {})
    }
    return defaultApi(path, options)
  })
  renderUsers('/admin/users?page=3&isActive=true')
  await waitFor(() => expect(firstSignal).toBeDefined())
  const search = screen.getByRole('textbox', { name: 'Пошук користувачів' })
  fireEvent.change(search, { target: { value: 'К' } })
  fireEvent.change(search, { target: { value: 'Ков' } })
  expect(api.mock.calls.some(([path]) => path.includes('search=%D0%9A&'))).toBe(false)
  await screen.findByRole('link', { name: /Андрій Коваль/ })
  expect(firstSignal?.aborted).toBe(true)
  expect(screen.getByLabelText('Поточний URL').textContent).not.toContain('page=3')
  expect(api.mock.calls.some(([path]) => path.startsWith('/admin/users?') && new URLSearchParams(path.split('?')[1]).get('search') === 'Ков' && path.includes('page=1'))).toBe(true)
})

it('loads further pages and resets page when filters change', async () => {
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.startsWith('/admin/users?')) return { items: [user], total: 101, pageSize: 50 }
    return defaultApi(path, options)
  })
  renderUsers()
  fireEvent.click(await screen.findByRole('button', { name: 'Наступна' }))
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith('/admin/users?') && path.includes('page=2'))).toBe(true))
  expect(screen.getByLabelText('Поточний URL').textContent).toContain('page=2')
  fireEvent.change(screen.getByLabelText('Фільтр за типом'), { target: { value: 'ADMIN' } })
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('page=1') && path.includes('accountType=ADMIN'))).toBe(true))
})

async function fillCreation() {
  fireEvent.click(screen.getByRole('button', { name: 'Додати користувача' }))
  await waitFor(() => expect(screen.getByLabelText('Компанія')).toContainHTML('company-1'))
  for (const [label, value] of Object.entries({ Логін: 'new-user', 'Ім’я': 'Марія', Прізвище: 'Коваль', Email: 'maria@example.com', Пароль: 'CopperMeadowLantern47!', 'Підтвердження паролю': 'CopperMeadowLantern47!' })) {
    fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
  }
  fireEvent.change(screen.getByLabelText('Компанія'), { target: { value: 'company-1' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Створити доступ' })).toBeEnabled())
}

it('blocks repeated creation while pending and displays the server error without losing form values', async () => {
  let reject: (error: unknown) => void = () => {}
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/admin/users' && options?.method === 'POST') return new Promise((_, rejectPromise) => { reject = rejectPromise })
    return defaultApi(path, options)
  })
  renderUsers()
  await fillCreation()
  const form = screen.getByRole('button', { name: 'Створити доступ' }).closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Створення…' })).toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Створення…' }))
  expect(api.mock.calls.filter(([path, options]) => path === '/admin/users' && options?.method === 'POST')).toHaveLength(1)
  reject({ problem: { detail: 'Нікнейм уже використаний або зарезервований.' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Перевірте виділені поля.')
  expect(screen.getByLabelText('Логін')).toHaveAccessibleDescription('Цей логін уже використаний або зарезервований. Оберіть інший.')
  expect(screen.getByLabelText('Логін')).toHaveValue('new-user')
})

it('marks required creation fields and leaves optional profile fields unmarked', async () => {
  renderUsers()
  await fillCreation()
  for (const name of ['Тип облікового запису', 'Логін', 'Ім’я', 'Прізвище', 'Email', 'Пароль', 'Підтвердження паролю', 'Компанія']) {
    const field = screen.getByLabelText(name, { exact: true })
    expect(field).toBeRequired()
    expect(field.closest('label')).toHaveTextContent('*')
  }
  for (const name of ['По батькові', 'Телефон', 'Посада']) {
    expect(screen.getByLabelText(name).closest('label')).not.toHaveTextContent('*')
  }
  expect(screen.getByText('Перетягніть файл сюди')).toBeInTheDocument()
  expect(screen.queryByText('Вибрати фото')).not.toBeInTheDocument()
})

it('explains a short password before sending and allows correction without losing values', async () => {
  renderUsers()
  await fillCreation()
  for (const name of ['Пароль', 'Підтвердження паролю']) fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value: 'Lake-49' } })
  fireEvent.click(screen.getByRole('button', { name: 'Створити доступ' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Пароль', { exact: true })).toHaveAccessibleDescription('Введіть щонайменше 8 символів без пробілів.')
  expect(screen.getByLabelText('Пароль', { exact: true })).toHaveFocus()
  expect(screen.getByLabelText('Пароль', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  expect(screen.getByLabelText('Логін')).toHaveValue('new-user')
  for (const name of ['Пароль', 'Підтвердження паролю']) fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value: 'Lake-49!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Створити доступ' }))
  expect(await screen.findByText('Доступ створено')).toBeInTheDocument()
})

it('shows required fields, invalid email, login and mismatched passwords at their controls', async () => {
  renderUsers()
  await fillCreation()
  for (const [name, value] of Object.entries({ 'Ім’я': '   ', Прізвище: '', Email: 'bad-email', Логін: 'тест', 'Підтвердження паролю': 'DifferentLantern47!' })) {
    fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } })
  }
  fireEvent.change(screen.getByLabelText('Компанія'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Створити доступ' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Ім’я')).toHaveAccessibleDescription('Вкажіть ім’я.')
  expect(screen.getByLabelText('Прізвище')).toHaveAccessibleDescription('Вкажіть прізвище.')
  expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/коректну email-адресу/)
  expect(screen.getByLabelText('Логін')).toHaveAccessibleDescription(/від 3 до 32/)
  expect(screen.getByLabelText('Підтвердження паролю')).toHaveAccessibleDescription(/Паролі не збігаються/)
  expect(screen.getByLabelText('Компанія')).toHaveAccessibleDescription('Оберіть компанію.')
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
})

it('displays structured server validation errors next to the named field', async () => {
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/admin/users' && options?.method === 'POST') throw { problem: { code: 'validation_failed', errors: { contactEmail: ['Перевірте email користувача.'] } } }
    return defaultApi(path, options)
  })
  renderUsers()
  await fillCreation()
  fireEvent.click(screen.getByRole('button', { name: 'Створити доступ' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Перевірте email користувача.')
  expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
})

it('keeps a created account after avatar failure and retries only the avatar', async () => {
  let avatarAttempts = 0
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/admin/users/created-user/avatar') {
      if (++avatarAttempts === 1) throw new Error('Фото завелике')
      return {}
    }
    return defaultApi(path, options)
  })
  renderUsers()
  await fillCreation()
  const photo = new File(['image'], 'avatar.png', { type: 'image/png' })
  const get = FormData.prototype.get
  const getSpy = vi.spyOn(FormData.prototype, 'get').mockImplementation(function (this: FormData, name: string) { return name === 'photo' ? photo : get.call(this, name) })
  fireEvent.click(screen.getByRole('button', { name: 'Створити доступ' }))
  getSpy.mockRestore()
  expect(await screen.findByRole('alert')).toHaveTextContent('Акаунт створено, але фото не завантажено')
  fireEvent.click(screen.getByRole('button', { name: 'Повторити завантаження фото' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(avatarAttempts).toBe(2)
  expect(api.mock.calls.filter(([path, options]) => path === '/admin/users' && options?.method === 'POST')).toHaveLength(1)
})

it('sends an explicit null when removing a department', async () => {
  renderUsers('/admin/users/user-1')
  await waitFor(() => expect(screen.getByLabelText('Підрозділ')).toHaveValue('unit-1'))
  fireEvent.change(screen.getByLabelText('Підрозділ'), { target: { value: '' } })
  expect(screen.getByLabelText('Підрозділ')).not.toBeRequired()
  expect(screen.getByRole('option', { name: 'Не у підрозділі' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  await waitFor(() => expect(api.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true))
  const [, options] = api.mock.calls.find(([, options]) => options?.method === 'PATCH')!
  expect(JSON.parse(options.body)).toHaveProperty('orgUnitId', null)
})

it.each(['USER', 'ADMIN'])('sets a %s password directly from the editor without approvals or the acting admin password', async (accountType) => {
  api.mockImplementation(async (path: string, options?: RequestInit) => path === '/admin/users/user-1' && !options?.method
    ? { ...user, accountType, ...(accountType === 'ADMIN' ? { company: null, orgUnit: null } : {}) } : defaultApi(path, options))
  renderUsers('/admin/users/user-1')
  await screen.findByLabelText('Ім’я')
  fireEvent.change(screen.getByLabelText('Новий пароль (за потреби)'), { target: { value: 'CopperMeadowLantern47!' } })
  fireEvent.change(screen.getByLabelText('Підтвердження нового паролю'), { target: { value: 'CopperMeadowLantern47!' } })
  expect(screen.queryByLabelText('Ваш поточний пароль')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('ID погодження')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Погодити зміну пароля' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Зберегти зміни' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  await waitFor(() => expect(api.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true))
  const [, options] = api.mock.calls.find(([, options]) => options?.method === 'PATCH')!
  expect(options.headers).toBeUndefined()
  const body = JSON.parse(options.body)
  expect(body.password).toBe('CopperMeadowLantern47!')
  expect(body.passwordConfirmation).toBe('CopperMeadowLantern47!')
  expect(body).not.toHaveProperty('credentialApprovalId')
  expect(api.mock.calls.some(([path]) => path === '/auth/reauth' || path.includes('credential-reset-approvals') || path.endsWith('/password-reset'))).toBe(false)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('offers a successor selector and displays the impact when deactivation is blocked', async () => {
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') throw { problem: { detail: 'Перед деактивацією оберіть нового відповідального: задачі — 2, документи — 1.' } }
    return defaultApi(path, options)
  })
  renderUsers('/admin/users/user-1')
  await screen.findByLabelText('Ім’я')
  fireEvent.change(screen.getByLabelText('Тип облікового запису'), { target: { value: 'INACTIVE' } })
  expect(screen.getByRole('combobox', { name: 'Новий відповідальний за задачі та документи' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Зберегти зміни' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('задачі — 2, документи — 1')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
