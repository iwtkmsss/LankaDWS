import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage, RestrictedAccessPage } from './AuthPages'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  api: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ state: 'anonymous', login: mocks.login, refresh: mocks.refresh }),
}))

vi.mock('../shared/api/client', () => ({
  api: mocks.api,
  jsonBody: (value: unknown) => JSON.stringify(value),
}))

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>)
}

describe('auth completion navigation', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.login.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.api.mockReset().mockResolvedValue(undefined)
  })

  it('sends password login completion to the canonical root', async () => {
    mocks.login.mockResolvedValue('AUTHENTICATED')
    renderPage(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText('maria'), { target: { value: 'maria' } })
    fireEvent.change(document.querySelector('input[autocomplete="current-password"]')!, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true }))
  })

  it.each([
    ['challenge', '/auth/2fa/challenge'],
    ['setup', '/auth/2fa/confirm'],
  ] as const)('sends TOTP %s completion to the canonical root', async (mode, endpoint) => {
    if (mode === 'setup') {
      mocks.api.mockResolvedValueOnce({ secret: 'SECRET', uri: 'otpauth://totp/bert' }).mockResolvedValueOnce(undefined)
    }
    renderPage(<RestrictedAccessPage mode={mode} />)
    if (mode === 'setup') fireEvent.click(screen.getByRole('button'))
    const code = await screen.findByRole('textbox')
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }))
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith(endpoint, expect.anything()))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true })
  })
})
