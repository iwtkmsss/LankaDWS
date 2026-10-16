import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import { TopbarContentProvider } from '../layout/TopbarContent'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user', accountType: 'USER' } }) }))
vi.mock('../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))

function FilterLocation() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output aria-label="URL фільтрів">{location.search}</output><button onClick={() => navigate(-1)}>Назад</button></>
}

function additionalFilters() {
  return screen.getByRole('group', { name: /^Додаткові фільтри:/ })
}

describe('task list defaults', () => {
  it('keeps the table mounted while the next status filter is loading', async () => {
    const task = { id: 'task', number: '123', title: 'Перевірка', priority: 'MEDIUM', status: 'NEW',
      responsibles: [], reporter: { id: 'user', displayName: 'Анна' }, subtaskProgress: { done: 0, total: 0 },
      deadline: null, commentCount: 0, attachmentCount: 0 }
    const initial = { items: [task], total: 1, page: 1, pageSize: 25 }
    let resolveNext!: (value: typeof initial) => void
    const next = new Promise<typeof initial>((resolve) => { resolveNext = resolve })
    request.mockImplementation((url: string) => {
      if (url.startsWith('/tasks?')) return new URLSearchParams(url.split('?')[1]).get('status') === 'DONE'
        ? next : Promise.resolve(initial)
      return Promise.resolve(url === '/saved-views' ? [] : { items: [] })
    })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks']}><TopbarContentProvider><TasksPage /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    const table = await screen.findByRole('table')
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'false'))
    fireEvent.click(screen.getByRole('button', { name: 'Виконані' }))
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'true'))
    expect(screen.getByRole('table')).toBe(table)
    expect(screen.getByText('Перевірка')).toBeVisible()
    await act(async () => resolveNext({ ...initial, items: [{ ...task, title: 'Інше завдання', status: 'DONE' }] }))
    expect(await screen.findByText('Інше завдання')).toBeVisible()
    expect(screen.getByRole('table')).toBe(table)
    expect(table).toHaveAttribute('aria-busy', 'false')
  })
  it('sorts through the API, resets pagination and renders task numbers with the number sign', async () => {
    const task = { id: 'task', number: '123', title: 'Перевірка', priority: 'MEDIUM', status: 'NEW',
      responsibles: [], reporter: { id: 'user', displayName: 'Анна' }, subtaskProgress: { done: 0, total: 0 },
      deadline: null, commentCount: 0, attachmentCount: 0 }
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [task], total: 30, page: 3, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?page=3&search=test']}><TopbarContentProvider><TasksPage /><FilterLocation /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    expect(await screen.findByText('№ 123')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Строк' }))
    await waitFor(() => expect(request.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/tasks?')
      && new URLSearchParams(url.split('?')[1]).get('sort') === 'dueDate'
      && new URLSearchParams(url.split('?')[1]).get('page') === '1')).toBe(true))
    expect(await screen.findByRole('columnheader', { name: 'Строк' })).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: 'Строк' }))
    expect(await screen.findByRole('columnheader', { name: 'Строк' })).toHaveAttribute('aria-sort', 'descending')
    expect(new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!).get('search')).toBe('test')
    fireEvent.click(screen.getByRole('button', { name: /Пошук і фільтри/ }))
    const clear = screen.getByRole('button', { name: 'Очисти фільтри' })
    expect(clear.closest('.task-advanced-filters__toolbar')).not.toBeNull()
    expect(clear.querySelector('svg')).not.toBeNull()
  })
  it('selects multiple statuses with checkboxes, shows their names and persists the URL', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?status=NEW&page=3']}><TopbarContentProvider><TasksPage /><FilterLocation /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Пошук і фільтри/ }))
    const status = screen.getByRole('combobox', { name: 'Статус' })
    expect(status).toHaveTextContent('Нове')
    fireEvent.click(status)
    const menu = screen.getByRole('dialog', { name: 'Вибір статусів' })
    expect(within(menu).getByRole('checkbox', { name: 'Нове' })).toBeChecked()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'В роботі' }))
    expect(status).toHaveTextContent('Нове, В роботі')
    expect(status).toHaveAttribute('title', 'Нове, В роботі')
    const params = new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!)
    expect(params.get('status')).toBe('NEW,IN_PROGRESS')
    expect(params.has('page')).toBe(false)
    await waitFor(() => expect(request.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/tasks?')
      && new URLSearchParams(url.split('?')[1]).get('status') === 'NEW,IN_PROGRESS')).toBe(true))
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(status).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('searches and selects people with the keyboard in every participant filter', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? []
      : url.startsWith('/employees?') ? { items: [
        { id: 'anna', displayName: 'Анна', jobTitle: '' },
      ] } : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks']}><TopbarContentProvider><TasksPage /><FilterLocation /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Пошук і фільтри' }))
    for (const [label, key] of [
      ['Відповідальний', 'assigneeId'], ['Постановник', 'creatorId'],
      ['Співвиконавець', 'coExecutorId'], ['Спостерігач', 'observerId'],
    ]) {
      const input = screen.getByRole('combobox', { name: label })
      fireEvent.focus(input)
      expect(screen.queryByRole('option', { name: 'Анна' })).not.toBeInTheDocument()
      fireEvent.change(input, { target: { value: 'а' } })
      expect(await screen.findByRole('option', { name: 'Анна' })).toBeVisible()
      await waitFor(() => expect(screen.queryByRole('option', { name: 'Іван' })).not.toBeInTheDocument())
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(input).toHaveValue('Анна')
      expect(screen.getByLabelText('URL фільтрів')).toHaveTextContent(`${key}=anna`)
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'невибране ім’я' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(input).toHaveValue('Анна')
      expect(input).toHaveAttribute('aria-expanded', 'false')
      fireEvent.change(input, { target: { value: '' } })
      expect(new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent ?? '').has(key)).toBe(false)
      fireEvent.keyDown(input, { key: 'Escape' })
    }
  })

  it('does not request a directory or blank user search when filters are opened', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?role=ALL&search=test']}><TopbarContentProvider><TasksPage /><FilterLocation /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Пошук і фільтри/ }))
    fireEvent.focus(screen.getByRole('combobox', { name: 'Відповідальний' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Відповідальний' }), { target: { value: '   ' } })
    await waitFor(() => expect(request).toHaveBeenCalledWith('/saved-views'))
    expect(request.mock.calls.some(([url]) => url.startsWith('/employees'))).toBe(false)
    const clear = screen.getByRole('button', { name: 'Очисти фільтри' })
    expect(clear).toBeEnabled()
    expect(clear.closest('.task-advanced-filters__toolbar')).toBeInTheDocument()
    fireEvent.click(clear)
    expect(clear).toBeDisabled()
    expect(screen.getByLabelText('URL фільтрів')).toHaveTextContent('')
    expect(screen.getByRole('button', { name: /Виконавець/ })).toHaveAttribute('aria-pressed', 'true')
  })

  beforeEach(() => { request.mockClear() })
  it('keeps advanced filters closed when opening a URL with active restrictions', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?search=test&priority=HIGH&preset=DUE_SOON']}><TopbarContentProvider><TasksPage /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    const toggle = screen.getByRole('button', { name: 'Пошук і фільтри · 3' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('combobox', { name: 'Статус' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Додаткові фільтри:/ })).not.toBeInTheDocument()
    expect(request.mock.calls.some(([url]) => url === '/saved-views')).toBe(false)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: 'Статус' })).toHaveTextContent('Скоро строк')
    fireEvent.click(screen.getByRole('button', { name: 'Фільтри: Активні' }))
    expect(within(additionalFilters()).getByRole('button', { name: 'Скоро строк' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(additionalFilters()).getByRole('button', { name: 'Відкладені' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('textbox', { name: 'Пошук завдань' })).toHaveValue('test')
  })
  it('retains task counts while refreshing them for new filters', async () => {
    const pending: Array<() => void> = []
    request.mockImplementation((url: string) => {
      const isTask = url.startsWith('/tasks?')
      const changed = isTask && new URLSearchParams(url.split('?')[1]).get('status') === 'DONE'
      const response = isTask ? { items: [], total: changed ? 2 : 7, page: 1, pageSize: 25 }
        : { items: [] }
      return changed ? new Promise((resolve) => pending.push(() => resolve(response))) : Promise.resolve(response)
    })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks']}><TopbarContentProvider><TasksPage /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    const role = screen.getByRole('button', { name: /Виконавець/ })
    await waitFor(() => expect(within(role).getByText('7')).toBeVisible())
    await waitFor(() => expect(within(screen.getByRole('button', { name: /Постановник/ })).getByText('7')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Виконані' }))
    await waitFor(() => expect(pending.length).toBeGreaterThan(1))
    expect(within(role).getByText('7')).toBeVisible()
    expect(within(screen.getByRole('button', { name: /Постановник/ })).getByText('7')).toBeVisible()
    pending.forEach((resolve) => resolve())
    await waitFor(() => expect(within(role).getByText('2')).toBeVisible())
    await waitFor(() => expect(within(screen.getByRole('button', { name: /Постановник/ })).getByText('2')).toBeVisible())
  })
  it('expands active statuses inline to the right and synchronizes all three highlighted controls', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks']}><TopbarContentProvider><TasksPage /><FilterLocation /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    const primaryControls = () => Array.from(screen.getByRole('group', { name: 'Статуси завдань' }).querySelectorAll('.task-status-filter__control')).map((control) => control.querySelector(':scope > button')?.textContent)
    expect(primaryControls()).toEqual(['Активні', 'Виконані', 'Усі статуси'])
    for (const name of ['Активні', 'Виконані', 'Усі статуси']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    const toggle = screen.getByRole('button', { name: 'Фільтри: Активні' })
    expect(toggle.closest('.task-status-filter__control')).toHaveTextContent('Активні')
    fireEvent.click(toggle)
    const menu = additionalFilters()
    expect(menu.closest('.task-active-status-accordion')).not.toBeNull()
    expect(menu.closest('.task-status-filter')).toHaveTextContent('Активні')
    expect(within(menu).queryByLabelText('Інші активні')).not.toBeInTheDocument()
    for (const name of ['Нове', 'В роботі', 'На перевірці']) expect(within(menu).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Виконані', 'Архівовані']) expect(within(menu).queryByRole('button', { name })).not.toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('button', { name: 'Нове' }))
    expect(additionalFilters()).toBeVisible()
    expect(screen.getByRole('button', { name: 'Активні' }).closest('.task-status-filter')).toHaveClass('is-partial')
    expect(screen.getByRole('button', { name: 'Усі статуси' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Виконані' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(toggle).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Усі статуси' }))
    expect(primaryControls()).toEqual(['Активні', 'Виконані', 'Усі статуси'])
    expect(screen.getByRole('button', { name: 'Активні' }).closest('.task-status-filter')).not.toHaveClass('is-partial')
    for (const name of ['Активні', 'Виконані', 'Усі статуси']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    expect(new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!).get('preset')).toBe('ALL')
    fireEvent.click(screen.getByRole('button', { name: 'Усі статуси' }))
    expect(screen.getByRole('button', { name: 'Активні' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Виконані' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Усі статуси' })).toHaveAttribute('aria-pressed', 'false')
    expect(new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!).get('preset')).toBe('DUE_SOON,DEFERRED,OVERDUE,NEW,IN_PROGRESS,IN_REVIEW')
    fireEvent.click(toggle)
    expect(within(additionalFilters()).queryByRole('button', { name: 'Виконані' })).not.toBeInTheDocument()
    expect(within(additionalFilters()).queryByRole('button', { name: 'Архівовані' })).not.toBeInTheDocument()
    expect(within(additionalFilters()).getByRole('button', { name: 'В роботі' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(additionalFilters(), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Виконані' }))
    for (const name of ['Активні', 'Виконані', 'Усі статуси']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    expect(new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!).get('preset')).toBe('DUE_SOON,DEFERRED,OVERDUE,NEW,IN_PROGRESS,IN_REVIEW,DONE')
    fireEvent.click(screen.getByRole('button', { name: 'Усі статуси' }))
    expect(screen.getByRole('button', { name: 'Активні' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Виконані' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Усі статуси' })).toHaveAttribute('aria-pressed', 'false')
  })
  it('starts without restrictions and clears checkbox selections back to all statuses', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks']}><TopbarContentProvider><TasksPage /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Пошук і фільтри' }))
    expect(screen.getByRole('button', { name: 'Очисти фільтри' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Виконані' }))
    expect(screen.getByRole('combobox', { name: 'Статус' })).toHaveTextContent('Виконані')
    expect(screen.getByRole('button', { name: 'Пошук і фільтри · 1' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Очисти фільтри' }))
    expect(screen.getByRole('combobox', { name: 'Статус' })).toHaveTextContent('Усі')
    expect(screen.getByRole('button', { name: 'Пошук і фільтри' })).toBeVisible()
  })
  it('restores mixed URL subsets, supports keyboard selection and an empty selection', async () => {
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?role=CREATOR&preset=DUE_SOON,DONE&page=3&search=test']}>
        <TopbarContentProvider><TasksPage /><FilterLocation /></TopbarContentProvider>
      </MemoryRouter>
    </QueryClientProvider>)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Фільтри: Активні' }), { key: 'ArrowDown' })
    const menu = additionalFilters()
    expect(within(menu).getByRole('button', { name: 'Скоро строк' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Виконані' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(within(menu).getByRole('button', { name: 'На перевірці' })).toHaveFocus()
    fireEvent.click(within(menu).getByRole('button', { name: 'Скоро строк' }))
    const params = new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!)
    expect(params.get('status')).toBe('DONE')
    expect(params.get('page')).toBeNull()
    expect(params.get('role')).toBe('CREATOR')
    expect(params.get('search')).toBe('test')
    fireEvent.click(screen.getByRole('button', { name: 'Виконані' }))
    expect(new URLSearchParams(screen.getByLabelText('URL фільтрів').textContent!).get('preset')).toBe('NONE')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('does not request or display unread role badges', async () => {
    request.mockClear()
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 }
      : url.startsWith('/notifications/tasks-summary?') ? { RESPONSIBLE: 0, CO_EXECUTOR: 0, CREATOR: 0, OBSERVER: 0, ALL: 0 }
      : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?role=CO_EXECUTOR&search=hidden&favorite=true&priority=HIGH&preset=ALL']}><TopbarContentProvider><TasksPage /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    await waitFor(() => expect(request.mock.calls.some(([url]) => typeof url === 'string'
      && url.startsWith('/tasks?') && url.includes('search=hidden') && url.includes('favorite=true') && url.includes('priority=HIGH'))).toBe(true))
    expect(request.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/notifications/tasks-summary'))).toBe(false)
    expect(document.querySelector('.task-role-unread')).toBeNull()
    expect(screen.queryByLabelText('3 непрочитаних сповіщень')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пошук і фільтри · 3' })).toBeVisible()
  })
  it('adds and removes roles from the selected block and requests their union', async () => {
    request.mockClear()
    request.mockImplementation((url: string) => Promise.resolve(url.startsWith('/tasks?')
      ? { items: [], total: 0, page: 1, pageSize: 25 } : url === '/saved-views' ? [] : { items: [] }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tasks?role=RESPONSIBLE,CREATOR&preset=ACTIVE,DUE_SOON&page=3']}><TopbarContentProvider><TasksPage /></TopbarContentProvider></MemoryRouter>
    </QueryClientProvider>)
    const selected = screen.getByRole('group', { name: 'Вибрані ролі' })
    expect(within(selected).getByRole('button', { name: /Виконавець/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(selected).getByRole('button', { name: /Постановник/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Співвиконавець/ }))
    expect(within(selected).getByRole('button', { name: /Співвиконавець/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Співвиконавець/ })).toHaveFocus()
    await waitFor(() => expect(request.mock.calls.some(([url]) => {
      if (typeof url !== 'string' || !url.startsWith('/tasks?')) return false
      const query = new URLSearchParams(url.split('?')[1])
      return query.get('role') === 'RESPONSIBLE,CREATOR,CO_EXECUTOR' && query.get('page') === '1' && query.get('preset') === 'DUE_SOON'
    })).toBe(true))
    fireEvent.click(within(selected).getByRole('button', { name: /Постановник/ }))
    expect(within(selected).queryByRole('button', { name: /Постановник/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Постановник/ })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(selected).getByRole('button', { name: /Виконавець/ }))
    fireEvent.click(within(selected).getByRole('button', { name: /Співвиконавець/ }))
    expect(within(selected).getByRole('button', { name: /Усі доступні/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Усі мої завдання')).not.toBeInTheDocument()
    await waitFor(() => expect(request.mock.calls.some(([url]) => typeof url === 'string'
      && url.startsWith('/tasks?') && new URLSearchParams(url.split('?')[1]).get('role') === 'RESPONSIBLE,CO_EXECUTOR,CREATOR,OBSERVER')).toBe(true))
    fireEvent.click(within(selected).getByRole('button', { name: /Усі доступні/ }))
    expect(within(selected).getByRole('button', { name: /Усі доступні/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Спостерігач/ }))
    expect(within(selected).queryByRole('button', { name: /Усі доступні/ })).not.toBeInTheDocument()
    expect(within(selected).getByRole('button', { name: /Спостерігач/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Усі доступні/ }))
    expect(within(selected).queryByRole('button', { name: /Спостерігач/ })).not.toBeInTheDocument()
    expect(within(selected).getByRole('button', { name: /Усі доступні/ })).toHaveAttribute('aria-pressed', 'true')
    expect(request.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/tasks?')
      && new URLSearchParams(url.split('?')[1]).get('role') === 'ALL')).toBe(false)
  })
})
