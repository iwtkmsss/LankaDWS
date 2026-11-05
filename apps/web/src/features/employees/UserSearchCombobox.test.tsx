import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserSearchCombobox } from './UserSearchCombobox'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../shared/api/client', () => ({ api: request }))

function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UserSearchCombobox label="Людина" name="personId" />
  </QueryClientProvider>)
  return screen.getByRole('combobox', { name: 'Людина' })
}

beforeEach(() => { request.mockReset(); request.mockResolvedValue({ items: [] }) })

describe('user search', () => {
  it('closes on a click outside without requiring another field to take focus', () => {
    const input = open()
    fireEvent.focus(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(document.body)
    expect(input).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })
  it('starts with one character, requests 5 results including admins and retains a selected person outside the initial directory page', async () => {
    request.mockImplementation((url) => Promise.resolve({ items: url === '/employees/search' ? [] : [{ id: 'user-999', displayName: 'Яна', jobTitle: '', accountType: 'ADMIN', avatarAsset: 'file_avatar' }] }))
    const input = open()
    fireEvent.focus(input)
    await waitFor(() => expect(request).toHaveBeenCalledWith('/employees/search', expect.objectContaining({ method: 'POST' })))
    fireEvent.change(input, { target: { value: 'я' } })
    expect(await screen.findByRole('option', { name: /Яна/ })).toBeVisible()
    expect(request).toHaveBeenCalledWith('/employees?search=%D1%8F&limit=5&accountType=ALL', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByRole('option', { name: /Яна/ }).querySelector('img')).toHaveAttribute('src', '/api/v1/me/avatar/file_avatar')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('Яна')
    expect(document.querySelector('input[name="personId"]')).toHaveValue('user-999')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.querySelector('input[name="personId"]')).toHaveValue('')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('loads five recommendations on focus without an input hint and selects with the keyboard', async () => {
    request.mockResolvedValue({ items: Array.from({ length: 5 }, (_, index) => ({
      id: `recommended-${index}`, displayName: `Людина ${index}`, jobTitle: '', avatarAsset: null,
    })) })
    const input = open()
    expect(request).not.toHaveBeenCalled()
    fireEvent.focus(input)
    expect(await screen.findAllByRole('option')).toHaveLength(5)
    expect(screen.queryByText('Введіть щонайменше 1 символ.')).not.toBeInTheDocument()
    const [url, init] = request.mock.calls[0]!
    expect(url).toBe('/employees/search')
    expect(JSON.parse(init.body)).toMatchObject({ q: '', limit: 5, recommendations: true })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('Людина 1')
    expect(document.querySelector('input[name="personId"]')).toHaveValue('recommended-1')
  })

  it('cancels the earlier search and prevents stale results from being selected', async () => {
    const queries: Array<{ signal: AbortSignal; resolve: (data: unknown) => void }> = []
    request.mockImplementation((_url, init) => new Promise((resolve) => { queries.push({ signal: init.signal, resolve }) }))
    const input = open()
    fireEvent.change(input, { target: { value: 'а' } })
    await waitFor(() => expect(queries).toHaveLength(1))
    fireEvent.change(input, { target: { value: 'б' } })
    expect(queries[0]!.signal.aborted).toBe(true)
    await waitFor(() => expect(queries).toHaveLength(2))
    queries[1]!.resolve({ items: [{ id: 'b', displayName: 'Богдан', jobTitle: '' }] })
    expect(await screen.findByRole('option', { name: 'Богдан' })).toBeVisible()
    queries[0]!.resolve({ items: [{ id: 'a', displayName: 'Анна', jobTitle: '' }] })
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Анна' })).not.toBeInTheDocument())
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.querySelector('input[name="personId"]')).toHaveValue('b')
  })
})
