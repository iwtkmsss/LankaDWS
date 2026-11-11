import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Shared menu primitive.
 *
 * Replaces the hand-rolled `role="menu"` popups (positioning, outside click, Escape, arrow keys).
 * - `Menu` renders only while `open`, focuses the first item, handles ArrowUp/ArrowDown/Home/End,
 *   closes on outside pointer / Escape / Tab and returns focus to `triggerRef` after Escape.
 * - Placement: inline (default; CSS positions it next to its trigger), `anchorRef` (fixed, below the
 *   anchor, flipped/clamped to the viewport) or `point` (fixed at a pointer position, clamped).
 * - `useDetailsMenu` gives `<details>/<summary>` menus the same keyboard and close behaviour.
 */

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])'
const NAV_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']
const VIEWPORT_INSET = 8

export type MenuCloseReason = 'escape' | 'outside' | 'tab'

export function menuItemElements(container: ParentNode | null | undefined): HTMLElement[] {
  return container ? Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : []
}

export function focusFirstMenuItem(container: ParentNode | null | undefined): boolean {
  const first = menuItemElements(container)[0]
  first?.focus()
  return Boolean(first)
}

/** Moves focus for ArrowUp/ArrowDown/Home/End. Returns true when the key was handled. */
export function handleMenuNavigationKey(event: { key: string; preventDefault: () => void }, container: ParentNode | null | undefined): boolean {
  if (!NAV_KEYS.includes(event.key)) return false
  const items = menuItemElements(container)
  if (items.length === 0) return false
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLElement)
  let next: number
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
  items[next]?.focus()
  return true
}

/** Keeps a popup of the given size fully inside the viewport. */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  inset = VIEWPORT_INSET,
): { left: number; top: number } {
  return {
    left: Math.max(inset, Math.min(x, viewportWidth - width - inset)),
    top: Math.max(inset, Math.min(y, viewportHeight - height - inset)),
  }
}

type DismissOptions = {
  open: boolean
  onClose: (reason: MenuCloseReason) => void
  /** Elements whose pointer events do not count as "outside" (menu itself, trigger, wrappers). */
  insideRefs: Array<RefObject<Element | null>>
  /** Receives focus after Escape. */
  triggerRef?: RefObject<HTMLElement | null>
  /** Extra "inside" test, e.g. a nested portal submenu. */
  isInside?: (target: Element) => boolean
}

function useMenuDismiss({ open, onClose, insideRefs, triggerRef, isInside }: DismissOptions) {
  const latest = useRef({ onClose, insideRefs, triggerRef, isInside })
  useEffect(() => { latest.current = { onClose, insideRefs, triggerRef, isInside } })
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const { insideRefs: refs, isInside: inside } = latest.current
      if (refs.some((ref) => ref.current?.contains(target))) return
      if (inside && target instanceof Element && inside(target)) return
      latest.current.onClose('outside')
    }
    const onKey = (event: KeyboardEvent) => {
      // A nested control (submenu, dialog) that already handled Escape keeps priority.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      latest.current.onClose('escape')
      latest.current.triggerRef?.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
}

export type MenuProps = Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'children'> & {
  open: boolean
  onClose: (reason: MenuCloseReason) => void
  /** Accessible name (aria-label). */
  label?: string
  /** Trigger button: clicks on it are not "outside" and it regains focus after Escape. */
  triggerRef?: RefObject<HTMLElement | null>
  /** Context-menu placement at viewport coordinates. */
  point?: { x: number; y: number } | null
  /** Anchored placement below this element. */
  anchorRef?: RefObject<HTMLElement | null>
  /** Render into document.body (needed for point/anchor menus inside transformed or clipped ancestors). */
  portal?: boolean
  /** Focus the first item when opened (default true). */
  focusOnOpen?: boolean
  /** Extra "inside" test for outside-click detection. */
  isInside?: (target: Element) => boolean
  children: ReactNode
}

export function Menu({
  open, onClose, label, triggerRef, point, anchorRef, portal = false, focusOnOpen = true, isInside,
  style, onKeyDown, children, ...rest
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null)
  useMenuDismiss({ open, onClose, insideRefs: [ref, ...(triggerRef ? [triggerRef] : [])], triggerRef, isInside })

  const fixed = Boolean(point || anchorRef)
  useLayoutEffect(() => {
    if (!open || !fixed) { setPlacement(null); return }
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    if (point) { setPlacement(clampToViewport(point.x, point.y, width, height)); return }
    const anchor = anchorRef?.current?.getBoundingClientRect()
    if (!anchor) return
    const below = anchor.bottom + 4
    const top = below + height > window.innerHeight - VIEWPORT_INSET && anchor.top - 4 - height >= VIEWPORT_INSET ? anchor.top - 4 - height : below
    setPlacement(clampToViewport(anchor.left, top, width, height))
  }, [open, fixed, point, anchorRef])

  useEffect(() => {
    if (open && focusOnOpen) focusFirstMenuItem(ref.current)
  }, [open, focusOnOpen])

  if (!open) return null
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (handleMenuNavigationKey(event, ref.current)) return
    if (event.key === 'Tab') onClose('tab')
  }
  const fixedStyle: CSSProperties | undefined = fixed
    ? { position: 'fixed', ...(placement ?? { left: point?.x ?? 0, top: point?.y ?? 0, visibility: 'hidden' as const }) }
    : undefined
  const menu = (
    <div ref={ref} role="menu" aria-label={label} {...rest} style={{ ...style, ...fixedStyle }} onKeyDown={handleKeyDown}>
      {children}
    </div>
  )
  return portal ? createPortal(menu, document.body) : menu
}

export function MenuItem({ type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} role="menuitem" {...props} />
}

/**
 * Behaviour for `<details className=… ><summary/><div role="menu">…</div></details>` menus:
 * controlled open state, outside click, Escape (focus back to the summary), focus first item on open,
 * ArrowUp/ArrowDown/Home/End inside the menu and ArrowDown on the summary to open.
 * Spread `detailsProps` on the `<details>` element.
 */
export function useDetailsMenu() {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => {
    if (ref.current) ref.current.open = false
    setOpen(false)
  }, [])
  useMenuDismiss({ open, onClose: close, insideRefs: [ref], triggerRef: undefined })
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') ref.current?.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => {
    if (open) focusFirstMenuItem(ref.current)
  }, [open])
  const detailsProps = {
    ref,
    open,
    onToggle: (event: { currentTarget: HTMLDetailsElement }) => setOpen(event.currentTarget.open),
    onKeyDown: (event: ReactKeyboardEvent<HTMLDetailsElement>) => {
      if (event.target instanceof HTMLElement && event.target.tagName === 'SUMMARY') {
        if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true) }
        return
      }
      handleMenuNavigationKey(event, ref.current)
    },
  }
  return { detailsProps, open, close }
}
