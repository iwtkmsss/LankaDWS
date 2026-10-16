import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TASK_STATUS_OPTIONS, type TaskStatusPreset } from './task-status-filters'

export function TaskStatusPicker({ selected, onChange, compact = false }: {
  selected: TaskStatusPreset[]
  onChange: (selected: TaskStatusPreset[]) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const allSelected = TASK_STATUS_OPTIONS.every((option) => selected.includes(option.value))
  const text = allSelected ? 'Усі' : selected.length
    ? TASK_STATUS_OPTIONS.filter((option) => selected.includes(option.value)).map((option) => option.label).join(', ')
    : 'Не вибрано'

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = compact ? trigger.current?.closest('.task-status-filter__control') : trigger.current
      const rect = anchor?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom - 16
      const above = rect.top - 16
      const height = Math.min(340, Math.max(below, above))
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: below >= Math.min(340, above) ? rect.bottom + 4 : Math.max(8, rect.top - height - 4), width, maxHeight: height })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, compact])

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    const outside = (event: Event) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open])

  return <>
    <button ref={trigger} type="button" role={compact ? undefined : 'combobox'}
      className={compact ? 'task-status-filter__toggle' : 'task-status-picker__control'}
      aria-label={compact ? 'Фільтри: Активні' : 'Статус'} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      title={compact ? undefined : text} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) }
        if (event.key === 'Escape') setOpen(false)
      }}>
      {!compact && <span>{text}</span>}<ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div id={id} ref={menu} className="task-status-picker__menu" style={position}
      role="dialog" aria-label={compact ? 'Додаткові фільтри: Активні' : 'Вибір статусів'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return }
        const inputs = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input'))
        const index = inputs.indexOf(document.activeElement as HTMLInputElement)
        const next = event.key === 'ArrowDown' ? (index + 1) % inputs.length
          : event.key === 'ArrowUp' ? (index + inputs.length - 1) % inputs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? inputs.length - 1 : -1
        if (next >= 0) { event.preventDefault(); inputs[next]?.focus() }
      }}>
      {TASK_STATUS_OPTIONS.map((option) => <label key={option.value}>
        <input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked
          ? [...selected, option.value] : selected.filter((value) => value !== option.value))} />
        <span>{option.label}</span>
      </label>)}
    </div>, document.body)}
  </>
}
