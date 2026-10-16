import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { TASK_STATUS_GROUPS, type TaskStatusPreset } from './task-status-filters'

export function TaskActiveStatusAccordion({ selected, onChange }: {
  selected: TaskStatusPreset[]
  onChange: (selected: TaskStatusPreset[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<TaskStatusPreset | null>(null)
  const openingFocus = useRef<'first' | 'last' | null>(null)
  const id = useId()
  const options = TASK_STATUS_GROUPS[0]!.options
  const selectedKey = selected.join(',')

  useLayoutEffect(() => {
    const measure = () => setWidth(menu.current?.scrollWidth ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [selectedKey])
  useLayoutEffect(() => {
    if (pendingFocus.current) menu.current?.querySelector<HTMLButtonElement>(`[data-preset="${pendingFocus.current}"]`)?.focus({ preventScroll: true })
    pendingFocus.current = null
  }, [selectedKey])
  useEffect(() => {
    if (!open) return
    if (openingFocus.current) {
      const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('button')
      buttons?.[openingFocus.current === 'last' ? buttons.length - 1 : 0]?.focus({ preventScroll: true })
      openingFocus.current = null
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const renderOption = (option: typeof options[number]) => <button key={option.value} type="button"
    aria-pressed={selected.includes(option.value)} data-preset={option.value}
    onClick={() => {
      pendingFocus.current = option.value
      onChange(selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value])
    }}>{option.label}</button>

  return <div className="task-active-status-accordion" ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }}>
    <button ref={trigger} type="button" className="task-status-filter__toggle" aria-label="Фільтри: Активні"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
          event.preventDefault()
          openingFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'
          setOpen(true)
        }
      }}><ChevronRight size={16} aria-hidden="true" /></button>
    <div className={`task-status-filter__reveal${open ? ' is-open' : ''}`} style={{ width: open ? width : 0 }} aria-hidden={!open} inert={!open}>
      <div id={id} ref={menu} className="task-status-filter__menu task-active-status-options" role="group" aria-label="Додаткові фільтри: Активні"
        onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index + 1) % buttons.length
            : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (index + buttons.length - 1) % buttons.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
          if (next >= 0) { event.preventDefault(); buttons[next]?.focus() }
        }}>
        {options.some((option) => selected.includes(option.value)) && <div className="task-filter-selection task-active-status-options__selected">
          {options.filter((option) => selected.includes(option.value)).map(renderOption)}
        </div>}
        {options.filter((option) => !selected.includes(option.value)).map(renderOption)}
      </div>
    </div>
  </div>
}
