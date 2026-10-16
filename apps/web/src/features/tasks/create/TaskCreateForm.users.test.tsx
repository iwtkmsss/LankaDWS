import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { TaskCreateForm } from './TaskCreateForm'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../../shared/api/client', async (load) => ({ ...await load<object>(), api: request }))
vi.mock('../../../shared/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', accountType: 'USER', displayName: 'Я' } }) }))

it('keeps the responsible user when the catalog has no user search page', async () => {
  localStorage.clear()
  request.mockImplementation((path: string) => Promise.resolve(path.startsWith('/tasks/options')
    ? { users: [], projects: [], tags: [], tasks: [] }
    : { id: path.endsWith('user-999') ? 'user-999' : 'me', displayName: path.endsWith('user-999') ? 'Яна' : 'Я', jobTitle: '', avatarAsset: null }))
  const router = createMemoryRouter([{ path: '/tasks/new', element:
    <TaskCreateForm initialResponsibleId="user-999" onClose={() => {}} onDone={() => {}} />,
  }], { initialEntries: ['/tasks/new'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RouterProvider router={router} />
  </QueryClientProvider>)
  const selected = await screen.findByRole('list', { name: 'Відповідальний: вибрані люди' })
  expect(await within(selected).findByText('Яна')).toBeVisible()
  expect(request).toHaveBeenCalledWith('/employees/user-999', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(screen.queryByText('Ще нікого не додано', { selector: '.task-create-role-card:has(#task-create-role-RESPONSIBLE) p' })).not.toBeInTheDocument()
})
