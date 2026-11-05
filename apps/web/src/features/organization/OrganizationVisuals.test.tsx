import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { CompanyLogoPicker } from './CompanyLogoPicker'
import { UnitIconPicker } from './OrganizationVisuals'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../shared/api/client', () => ({ api }))

beforeEach(() => {
  api.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:logo-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

it('shows eight named icons and lets the user select a department icon', () => {
  const onChange = vi.fn()
  render(<UnitIconPicker value="scales" onChange={onChange} />)
  expect(screen.getAllByRole('radio')).toHaveLength(8)
  expect(screen.getByRole('radio', { name: 'Ваги' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Комп’ютер' }))
  expect(onChange).toHaveBeenCalledWith('computer')
})

it('waits for scanning before choosing a new logo and previews the selected image', async () => {
  api.mockResolvedValueOnce({ id: 'file_logo' }).mockResolvedValueOnce({ scanStatus: 'CLEAN' })
  const onChange = vi.fn()
  const onBusyChange = vi.fn()
  render(<CompanyLogoPicker value={null} onChange={onChange} onBusyChange={onBusyChange} />)
  fireEvent.change(screen.getByLabelText('Фото або логотип'), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } })
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('file_logo'))
  expect(api).toHaveBeenCalledWith('/files/file_logo/status', expect.anything())
  expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  expect(document.querySelector('img')).toHaveAttribute('src', 'blob:logo-preview')
})

it('keeps the existing logo when an upload is blocked', async () => {
  api.mockResolvedValueOnce({ id: 'file_logo' }).mockResolvedValueOnce({ scanStatus: 'BLOCKED' })
  const onChange = vi.fn()
  render(<CompanyLogoPicker value="file_old" src="/old-logo.png" onChange={onChange} onBusyChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Фото або логотип'), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('не пройшло перевірку')
  expect(onChange).not.toHaveBeenCalled()
  expect(document.querySelector('img')).toHaveAttribute('src', '/old-logo.png')
})

it('rejects unsupported images without uploading and lets the user remove an existing logo', () => {
  const onChange = vi.fn()
  render(<CompanyLogoPicker value="file_old" src="/old-logo.png" onChange={onChange} onBusyChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Фото або логотип'), { target: { files: [new File(['svg'], 'logo.svg', { type: 'image/svg+xml' })] } })
  expect(screen.getByRole('alert')).toHaveTextContent('PNG, JPEG або WebP')
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Видалити логотип' }))
  expect(onChange).toHaveBeenCalledWith(null)
})
