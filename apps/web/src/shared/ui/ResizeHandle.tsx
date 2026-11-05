import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import './resize-handle.css'

export function ResizeHandle({ targetRef, selector, controls, label = 'Змінити висоту поля', disabled = false }: {
  targetRef: RefObject<HTMLElement | null>
  selector?: string
  controls: string
  label?: string
  disabled?: boolean
}) {
  const drag = useRef<{ y: number; height: number; pointerId: number } | null>(null)
  const [height, setHeight] = useState(0)
  const [limits, setLimits] = useState({ min: 0, max: Number.MAX_SAFE_INTEGER })
  const target = () => selector ? targetRef.current?.querySelector<HTMLElement>(selector) : targetRef.current

  useLayoutEffect(() => {
    const element = selector ? targetRef.current?.querySelector<HTMLElement>(selector) : targetRef.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      setHeight(Math.round(element.getBoundingClientRect().height))
      setLimits({ min: Number.parseFloat(style.minHeight) || 32, max: Number.parseFloat(style.maxHeight) || Number.MAX_SAFE_INTEGER })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [targetRef, selector])

  function resize(element: HTMLElement, next: number) {
    const style = getComputedStyle(element)
    const minimum = Number.parseFloat(style.minHeight) || 32
    const maximum = Number.parseFloat(style.maxHeight) || Infinity
    element.style.height = `${Math.min(maximum, Math.max(minimum, next))}px`
    setHeight(Math.round(element.getBoundingClientRect().height))
  }

  return <div className="resize-handle" role="separator" tabIndex={disabled ? -1 : 0}
    aria-label={label} aria-orientation="horizontal" aria-controls={controls} aria-valuenow={height}
    aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuetext={`${height} пікселів`}
    aria-disabled={disabled || undefined} hidden={disabled}
    onPointerDown={(event) => {
      const element = target()
      if (disabled || event.button !== 0 || !element) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { y: event.clientY, height: element.getBoundingClientRect().height, pointerId: event.pointerId }
    }}
    onPointerMove={(event) => {
      const active = drag.current
      const element = target()
      if (!disabled && element && active && active.pointerId === event.pointerId) resize(element, active.height + event.clientY - active.y)
    }}
    onPointerUp={(event) => {
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={(event) => {
      const element = target()
      if (disabled || !element || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      event.stopPropagation()
      resize(element, element.getBoundingClientRect().height + (event.key === 'ArrowDown' ? 1 : -1) * (event.shiftKey ? 40 : 10))
    }} />
}
