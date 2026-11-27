import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppNotice } from './AppNotice'
import { notifyError, notifySuccess } from './notify'
import { showFileError } from '../files/uploadValidation'
import { ApiProblem } from '../api/client'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('shows a green success status that hides itself', () => {
  vi.useFakeTimers()
  render(<AppNotice />)
  act(() => notifySuccess('Зміни збережено'))
  const notice = screen.getByRole('status')
  expect(notice).toHaveTextContent('Зміни збережено')
  expect(notice).toHaveClass('app-notice--success')
  act(() => vi.advanceTimersByTime(4_000))
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows errors as alerts, including legacy file errors, and closes on demand', () => {
  render(<AppNotice />)
  act(() => showFileError('Файл порожній'))
  expect(screen.getByRole('alert')).toHaveClass('app-notice--error')
  act(() => notifyError('Не вдалося'))
  expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося')
  fireEvent.click(screen.getByRole('button', { name: 'Закрити повідомлення' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('offers undo, keeps the notice while undoing and confirms or reports the result', async () => {
  render(<AppNotice />)
  const undo = vi.fn().mockResolvedValue(undefined)
  act(() => notifySuccess('Переміщено в кошик', { undo }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Скасувати' })) })
  expect(undo).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Дію скасовано')
  act(() => notifySuccess('Подію видалено', { undo: () => Promise.reject(new ApiProblem({ type: 'about:blank', title: 'Conflict', detail: 'task_version', status: 409, code: 'conflict', correlationId: 'c' })) }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Скасувати' })) })
  expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося скасувати: запис уже змінено. Оновіть сторінку')
})
