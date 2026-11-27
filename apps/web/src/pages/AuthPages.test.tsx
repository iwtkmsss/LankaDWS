import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage, RestrictedAccessPage } from './AuthPages'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  api: vi.fn(),
  logout: vi.fn(),
  state: 'anonymous' as 'loading' | 'anonymous' | 'restricted',
  user: null as { secondFactorStep?: 'CHALLENGE' | 'ENROLL' | null; mustEnroll2FA?: boolean } | null,
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../shared/auth/AuthProvider', () => ({
  useAuth: () => ({ state: mocks.state, user: mocks.user, login: mocks.login, refresh: mocks.refresh, logout: mocks.logout }),
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
    mocks.state = 'anonymous'
    mocks.user = null
  })

  function restricted(step: 'CHALLENGE' | 'ENROLL') {
    mocks.state = 'restricted'
    mocks.user = { secondFactorStep: step }
  }

  it('asks for the authenticator code in the same sign-in card, without leaving the page', async () => {
    mocks.login.mockImplementation(() => { mocks.state = 'restricted'; return Promise.resolve('TWO_FACTOR') })
    renderPage(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText('maria'), { target: { value: 'maria' } })
    fireEvent.change(document.querySelector('input[autocomplete="current-password"]')!, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }))
    expect(await screen.findByRole('heading', { name: 'Підтвердження входу' })).toBeVisible()
    expect(screen.getByLabelText('Код із застосунку')).toBeVisible()
    expect(screen.queryByPlaceholderText('maria')).not.toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('has no separate access-help link on the sign-in card', () => {
    renderPage(<LoginPage />)
    expect(screen.queryByText('Не вдається увійти?')).not.toBeInTheDocument()
  })

  it('sends password login completion to the canonical root', async () => {
    mocks.login.mockResolvedValue('AUTHENTICATED')
    renderPage(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText('maria'), { target: { value: 'maria' } })
    fireEvent.change(document.querySelector('input[autocomplete="current-password"]')!, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true }))
  })

  it('keeps the login form hidden while the existing session is being checked', () => {
    mocks.state = 'loading'
    renderPage(<LoginPage />)
    expect(screen.getByRole('status', { name: 'Завантаження' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Увійти до Lanka' })).not.toBeInTheDocument()
  })

  it('accepts an eight-character password on first login', async () => {
    renderPage(<RestrictedAccessPage mode="first-login" />)
    for (const label of ['Новий пароль', 'Повторіть пароль']) {
      const field = screen.getByLabelText(label)
      expect(field).toHaveAttribute('minlength', '8')
      fireEvent.change(field, { target: { value: 'Lake-49!' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти пароль' }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/auth/first-login/password', {
      method: 'POST', body: JSON.stringify({ newPassword: 'Lake-49!', confirmation: 'Lake-49!' }),
    }))
  })

  it('sends the authenticator code after the password and opens the app', async () => {
    restricted('CHALLENGE')
    renderPage(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Код із застосунку'), { target: { value: '12 34-56' } })
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/auth/2fa/challenge', { method: 'POST', body: JSON.stringify({ code: '123456' }) }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('sends people without their phone to an administrator, with no recovery codes', () => {
    restricted('CHALLENGE')
    renderPage(<LoginPage />)
    fireEvent.click(screen.getByText('Немає доступу до телефону?'))
    expect(screen.getByText(/Зверніться до адміністратора/u)).toBeVisible()
    expect(screen.queryByText(/Резервний код/u)).not.toBeInTheDocument()
  })

  it('enrols on one screen: QR code or manual key, then the code', async () => {
    mocks.api
      .mockResolvedValueOnce({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/LankaDWS:maria?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' })
      .mockResolvedValueOnce({ nextStep: 'AUTHENTICATED' })
    restricted('ENROLL')
    renderPage(<LoginPage />)
    expect(await screen.findByRole('link', { name: /QR-код/u })).toHaveAttribute('href', expect.stringContaining('otpauth://totp/'))
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Не сканується?' }))
    expect(screen.getByLabelText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible()
    expect(screen.queryByRole('link', { name: /QR-код/u })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Показати QR-код' }))
    expect(screen.getByRole('link', { name: /QR-код/u })).toBeVisible()
    fireEvent.change(screen.getByLabelText('Код із застосунку'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Підключити' }))
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith('/auth/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: '123456' }) }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true })
    expect(screen.queryByText(/Резервні коди/u)).not.toBeInTheDocument()
  })
})
