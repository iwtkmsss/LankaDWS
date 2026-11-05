import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TaskDetailPreferenceController } from './TaskDetailPreferences'
import {
  DEFAULT_TASK_DETAIL_PREFERENCE,
  TaskDetailCustomization,
  TaskDetailSection,
  TaskDetailSections,
} from './TaskDetailPreferences'

function controller(
  value: TaskDetailPreferenceController['value'],
): TaskDetailPreferenceController {
  return {
    value,
    stored: null,
    isLoading: false,
    isDirty: true,
    isSaving: false,
    message: '',
    move: vi.fn(),
    setVisible: vi.fn(),
    setCollapsed: vi.fn(),
    save: vi.fn(),
    reset: vi.fn(),
  }
}

describe('Task Detail customization', () => {
  it('collapses every section in the default layout', () => {
    expect(DEFAULT_TASK_DETAIL_PREFERENCE.collapsed).toEqual(DEFAULT_TASK_DETAIL_PREFERENCE.order)
  })

  it('renders sections in preference order and omits hidden sections', () => {
    const state = controller({
      order: ['discussion', 'personal', 'participants', 'subtasks', 'checklist', 'recurrence', 'materials', 'history'],
      hidden: ['participants'],
      collapsed: [],
    })
    const view = render(
      <TaskDetailSections controller={state}>
        <TaskDetailSection id="personal" label="Для мене"><p>personal-content</p></TaskDetailSection>
        <TaskDetailSection id="participants" label="Учасники"><p>participants-content</p></TaskDetailSection>
        <TaskDetailSection id="discussion" label="Обговорення"><p>discussion-content</p></TaskDetailSection>
      </TaskDetailSections>,
    )

    expect(screen.queryByText('participants-content')).not.toBeInTheDocument()
    const text = view.container.textContent ?? ''
    expect(text.indexOf('discussion-content')).toBeLessThan(text.indexOf('personal-content'))
  })

  it('collapses a section and exposes an accessible expand action', () => {
    const state = controller({
      order: ['personal', 'participants', 'subtasks', 'checklist', 'recurrence', 'materials', 'history', 'discussion'],
      hidden: [],
      collapsed: ['personal'],
    })
    render(
      <TaskDetailSections controller={state}>
        <TaskDetailSection id="personal" label="Для мене"><p>personal-content</p></TaskDetailSection>
      </TaskDetailSections>,
    )

    expect(screen.queryByText('personal-content')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Розгорнути секцію «Для мене»' }))
    expect(state.setCollapsed).toHaveBeenCalledWith('personal', false)
  })

  it('offers move, visibility, collapse, save, and reset controls', () => {
    const state = controller({
      order: ['personal', 'participants', 'subtasks', 'checklist', 'recurrence', 'materials', 'history', 'discussion'],
      hidden: [],
      collapsed: [],
    })
    render(<TaskDetailCustomization controller={state} />)
    fireEvent.click(screen.getByText('Налаштувати сторінку'))
    fireEvent.click(screen.getByRole('button', { name: 'Перемістити «Учасники» вище' }))
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Показувати' })[0]!)
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Згорнуто' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти вигляд' }))
    fireEvent.click(screen.getByRole('button', { name: 'За замовчуванням' }))

    expect(state.move).toHaveBeenCalledWith('participants', -1)
    expect(state.setVisible).toHaveBeenCalledWith('personal', false)
    expect(state.setCollapsed).toHaveBeenCalledWith('personal', true)
    expect(state.save).toHaveBeenCalledOnce()
    expect(state.reset).toHaveBeenCalledOnce()
  })
})
