import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { UnassignedEmployees } from './UnassignedEmployees'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../shared/api/client', () => ({ api }))

it('allows dragging without showing assignment controls and leaves read-only rows non-draggable', async () => {
  const employee = { id: 'person', displayName: 'Марія Іваненко', jobTitle: 'Дизайнерка', avatarAsset: null }
  api.mockResolvedValue({ items: [employee], total: 1, nextCursor: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}>
    <UnassignedEmployees companyId="company" draggable />
  </QueryClientProvider>)
  const row = (await screen.findByText(employee.displayName)).closest('li')!
  expect(row).toHaveAttribute('draggable', 'true')
  expect(screen.queryByLabelText('Перенести до підрозділу')).not.toBeInTheDocument()
  const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
  fireEvent.dragStart(row, { dataTransfer })
  expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-lankadws-employee', employee.id)
  expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', employee.id)
  expect(dataTransfer.effectAllowed).toBe('move')
  view.rerender(<QueryClientProvider client={client}>
    <UnassignedEmployees companyId="company" />
  </QueryClientProvider>)
  expect(row).toHaveAttribute('draggable', 'false')
})

it('pages through company users and assigns only after choosing a department', async () => {
  const employee = { id: 'person', displayName: 'Марія Іваненко', jobTitle: 'Дизайнерка', avatarAsset: null }
  api.mockImplementation(async (path: string) => path.includes('?cursor=')
    ? { items: [{ ...employee, id: 'next', displayName: 'Андрій Коваль' }], total: 21, nextCursor: null }
    : { items: [employee], total: 21, nextCursor: 'person' })
  const unit = { id: 'unit', companyId: 'company', name: 'Дизайн', parentId: null, description: null, manager: null, activeEmployeeCount: 0, childCount: 0, sortOrder: 10, version: 3 }
  const onAssign = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UnassignedEmployees companyId="company" units={[unit]} onAssign={onAssign} />
  </QueryClientProvider>)
  const move = await screen.findByRole('button', { name: 'Розподілити Марія Іваненко' })
  expect(screen.getByRole('heading', { name: 'Не у підрозділі' })).toBeInTheDocument()
  expect(move).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Перенести до підрозділу'), { target: { value: 'unit' } })
  fireEvent.click(move)
  expect(onAssign).toHaveBeenCalledWith(employee, unit)
  fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
  await screen.findByText('Андрій Коваль')
  expect(api).toHaveBeenCalledWith('/org/companies/company/unassigned-employees?cursor=person')
  expect(screen.getByRole('button', { name: 'Далі' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await waitFor(() => expect(screen.getByText('Марія Іваненко')).toBeInTheDocument())
})
