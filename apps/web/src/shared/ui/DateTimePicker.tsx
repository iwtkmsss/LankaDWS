import { useEffect, useId, useRef, useState, type CSSProperties, type InputHTMLAttributes, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react'
import './date-time-picker.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type: 'date' | 'datetime-local' | 'time'
  ref?: Ref<HTMLInputElement>
}
const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const wrap = (value: number, count: number) => ((value % count) + count) % count
const displayValue = (value: string, type: Props['type']) => {
  if (!value) return ''
  if (type === 'time') return value
  const [date, time] = value.split('T')
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}${time ? `, ${time}` : ''}`
}
const months = Array.from({ length: 12 }, (_, month) => new Date(2026, month, 1).toLocaleDateString('uk-UA', { month: 'long' }))

/** A rotating cylinder: pointer, touch, wheel and keyboard share the same selection. */
function TimeWheel({ label, count, value, onChange }: { label: string; count: number; value: number; onChange: (value: number) => void }) {
  const [position, setPosition] = useState(value)
  const drag = useRef<{ y: number; position: number } | null>(null)
  const wheelDelta = useRef(0)
  useEffect(() => { if (!drag.current) setPosition(value) }, [value])
  function move(next: number) {
    setPosition(next)
    onChange(wrap(Math.round(next), count))
  }
  return <div className="date-time-wheel-group">
    <span className="date-time-wheel-label">{label}</span>
    <div className="date-time-wheel" role="spinbutton" tabIndex={0} aria-label={label}
      aria-valuemin={0} aria-valuemax={count - 1} aria-valuenow={value} aria-valuetext={pad(value)}
      onWheel={(event) => {
        wheelDelta.current += event.deltaY
        if (Math.abs(wheelDelta.current) >= 24) {
          move(Math.round(position) + Math.sign(wheelDelta.current))
          wheelDelta.current = 0
        }
      }}
      onKeyDown={(event) => {
        const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[event.key]
        if (step !== undefined) { event.preventDefault(); move(Math.round(position) + step) }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); move(event.key === 'Home' ? 0 : count - 1) }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, position }
      }}
      onPointerMove={(event) => { if (drag.current) move(drag.current.position + (drag.current.y - event.clientY) / 36) }}
      onPointerUp={(event) => {
        if (!drag.current) return
        if (Math.abs(event.clientY - drag.current.y) < 4) {
          const rect = event.currentTarget.getBoundingClientRect()
          move(Math.round(position) + Math.round((event.clientY - rect.top - rect.height / 2) / 36))
        } else move(Math.round(position))
        drag.current = null
      }}
      onPointerCancel={() => { drag.current = null; setPosition(value) }}>
      <div className="date-time-wheel-cylinder" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => {
          const number = Math.round(position) + index - 4
          const distance = number - position
          return <span key={number} className="date-time-wheel-number" style={{
            transform: `rotateX(${-distance * 23}deg) translateZ(92px)`,
            opacity: Math.max(0, 1 - Math.abs(distance) / 4),
          }}>{pad(wrap(number, count))}</span>
        })}
      </div>
    </div>
  </div>
}

/** Custom picker UI with a hidden form control for values, constraints and refs. */
export function DateTimePicker({ type, ref, className = '', onChange, disabled, readOnly, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [month, setMonth] = useState(() => new Date())
  const [position, setPosition] = useState<CSSProperties>({})
  const [error, setError] = useState('')
  const [value, setValue] = useState(() => String(props.value ?? props.defaultValue ?? ''))
  const hasDate = type !== 'time'
  const hasTime = type !== 'date'
  const selectedDate = draft.slice(0, 10)
  const time = type === 'time' ? draft : draft.split('T')[1] ?? '09:00'
  const hour = Number(time.slice(0, 2)) || 0
  const minute = Number(time.slice(3, 5)) || 0

  useEffect(() => {
    const element = input.current
    if (!element || props['aria-label'] || props['aria-labelledby']) return
    const label = element.labels?.[0]?.cloneNode(true) as HTMLElement | undefined
    label?.querySelectorAll('input, button, select, textarea, [aria-hidden="true"]').forEach((child) => child.remove())
    const name = label?.textContent?.replace(/\s+/g, ' ').trim()
    if (name) element.setAttribute('aria-label', name)
  })

  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  function show() {
    if (disabled || readOnly) return
    const now = new Date()
    const initial = input.current?.value || (type === 'time' ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : `${dateKey(now)}${hasTime ? 'T09:00' : ''}`)
    setDraft(initial)
    setMonth(type === 'time' ? now : new Date(`${initial.slice(0, 10)}T12:00`))
    setError('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const panel = menu.current!
    panel.showPopover?.()
    function place() {
      const rect = field.current!.getBoundingClientRect()
      const width = Math.min(hasDate && hasTime ? 490 : 330, window.innerWidth - 24)
      const height = Math.min(panel.getBoundingClientRect().height || 390, window.innerHeight - 24)
      setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12)) })
    }
    place()
    const focusTarget = panel.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)')
      ?? panel.querySelector<HTMLElement>('[role="spinbutton"], button')
    focusTarget?.focus({ preventScroll: true })
    const resize = new ResizeObserver(place)
    resize.observe(panel)
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.contains(event.target) && !field.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    // Prevent the page from scrolling while turning a time wheel.
    function wheel(event: WheelEvent) { if ((event.target as Element).closest('.date-time-wheel')) event.preventDefault() }
    panel.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      panel.removeEventListener('wheel', wheel)
    }
  }, [open, hasDate, hasTime])

  function commit(next: string) {
    const element = input.current!
    const previous = element.value
    element.value = next
    if (!element.validity.valid && next !== '') {
      setError(element.validationMessage)
      element.value = previous
      return
    }
    element.value = previous
    // Use the native setter so React detects the same change as manual input.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, next)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    close()
  }
  function changeTime(hours: number, minutes: number) {
    setDraft(`${hasDate ? `${selectedDate}T` : ''}${pad(hours)}:${pad(minutes)}`)
    setError('')
  }
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - (first.getDay() + 6) % 7)
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start); day.setDate(start.getDate() + index); return day
  })
  const focusDay = days.some((day) => dateKey(day) === selectedDate) ? selectedDate
    : days.map(dateKey).find((key) => key.slice(0, 7) === dateKey(month).slice(0, 7) && (!props.min || key >= String(props.min).slice(0, 10)) && (!props.max || key <= String(props.max).slice(0, 10)))
  function selectDay(day: Date) { setDraft(`${dateKey(day)}${hasTime ? `T${time}` : ''}`); setError('') }
  const portalRoot = field.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body
  return <div ref={field} className={`date-time-field ${className}`} data-disabled={disabled || readOnly || undefined}>
    <input {...props} type={type} disabled={disabled} readOnly={readOnly} hidden tabIndex={-1}
      ref={(element) => { input.current = element; if (typeof ref === 'function') ref(element); else if (ref) ref.current = element }}
      onChange={(event) => { setValue(event.target.value); onChange?.(event) }}
      onInvalid={(event) => {
        props.onInvalid?.(event)
        if (event.defaultPrevented) return
        event.preventDefault()
        show()
        setError(event.currentTarget.validationMessage)
      }} />
    <button ref={trigger} type="button" className="date-time-field-trigger" disabled={disabled || readOnly}
      aria-label={hasDate ? 'Відкрити календар' : 'Вибрати час'} aria-expanded={open} aria-controls={open ? id : undefined}
      aria-describedby={`${id}-value`} aria-haspopup="dialog" onClick={() => open ? close() : show()}
      onKeyDown={(event) => {
        if (!event.defaultPrevented && (event.key === 'F4' || (event.altKey && event.key === 'ArrowDown'))) { event.preventDefault(); show() }
      }}>
      <span id={`${id}-value`} className="date-time-field-value">{displayValue(String(props.value ?? value), type) || props.placeholder || (hasDate ? 'Оберіть дату' : 'Оберіть час')}</span>
      {hasDate ? <CalendarDays size={18} aria-hidden /> : <Clock3 size={18} aria-hidden />}
    </button>
    {open && createPortal(<div ref={menu} id={id} popover="manual" role="dialog" aria-label={hasDate ? 'Вибір дати' : 'Вибір часу'}
      data-date-picker-menu className="date-time-menu" style={position}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        if (event.key === 'Tab') {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, [tabindex="0"]'))
          const firstItem = items[0], lastItem = items.at(-1)
          if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem?.focus() }
          if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem?.focus() }
        }
      }}>
      <div className="date-time-menu-heading"><span>{hasDate ? 'Дата' : 'Час'}</span><button type="button" aria-label="Закрити календар" onClick={close}><X size={16} /></button></div>
      <div className={`date-time-menu-body ${hasDate && hasTime ? 'date-time-menu-body--combined' : ''}`}>
        {hasDate && <div className="date-time-calendar">
          <div className="date-time-month">
            <button type="button" aria-label="Попередній місяць" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
            <select aria-label="Місяць" value={month.getMonth()} onChange={(event) => setMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}>{months.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
            <select aria-label="Рік" value={month.getFullYear()} onChange={(event) => setMonth(new Date(Number(event.target.value), month.getMonth(), 1))}>{Array.from({ length: 201 }, (_, index) => new Date().getFullYear() - 100 + index).concat(month.getFullYear()).filter((year, index, all) => all.indexOf(year) === index).sort((a, b) => a - b).map((year) => <option key={year}>{year}</option>)}</select>
            <button type="button" aria-label="Наступний місяць" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
          </div>
          <div className="date-time-weekdays" aria-hidden>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-time-days" role="grid" aria-label="Дні місяця">
            {Array.from({ length: 6 }, (_, row) => <div role="row" className="date-time-week" key={row}>{days.slice(row * 7, row * 7 + 7).map((day) => {
              const key = dateKey(day)
              const blocked = Boolean((props.min && key < String(props.min).slice(0, 10)) || (props.max && key > String(props.max).slice(0, 10)))
              return <button type="button" key={key} role="gridcell" aria-selected={selectedDate === key}
                aria-label={day.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })}
                aria-current={key === dateKey(new Date()) ? 'date' : undefined} disabled={blocked}
                tabIndex={focusDay === key ? 0 : -1} data-outside={day.getMonth() !== month.getMonth() || undefined}
                onClick={() => selectDay(day)} onKeyDown={(event) => {
                  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
                  if (step === undefined) return
                  event.preventDefault()
                  const next = new Date(day); next.setDate(day.getDate() + step)
                  const nextKey = dateKey(next)
                  if ((props.min && nextKey < String(props.min).slice(0, 10)) || (props.max && nextKey > String(props.max).slice(0, 10))) return
                  selectDay(next); setMonth(new Date(next.getFullYear(), next.getMonth(), 1))
                  requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
                }}>{day.getDate()}</button>
            })}</div>)}
          </div>
        </div>}
        {hasTime && <div className="date-time-clock"><span className="date-time-clock-title">Час</span><div className="date-time-wheels">
          <TimeWheel label="Години" count={24} value={hour} onChange={(next) => changeTime(next, minute)} />
          <span className="date-time-colon" aria-hidden>:</span>
          <TimeWheel label="Хвилини" count={60} value={minute} onChange={(next) => changeTime(hour, next)} />
        </div></div>}
      </div>
      {error && <p className="date-time-error" role="alert">{error}</p>}
      <div className="date-time-menu-footer"><button type="button" disabled={props.required} onClick={() => commit('')}>Очистити</button><button type="button" className="date-time-apply" onClick={() => commit(draft)}>Застосувати</button></div>
    </div>, portalRoot)}
  </div>
}
