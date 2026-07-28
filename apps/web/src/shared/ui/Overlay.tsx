import type {
  PropsWithChildren,
  ReactNode,
  RefObject,
} from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface OverlayEntry {
  id: string
  requestClose: () => void
  escapeAllowed: () => boolean
}

interface OverlayContextValue {
  register: (entry: OverlayEntry) => () => void
  isTop: (id: string) => boolean
  hasOverlay: boolean
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

export function OverlayProvider({ children }: PropsWithChildren) {
  const [stack, setStack] = useState<OverlayEntry[]>([])
  const stackRef = useRef(stack)
  stackRef.current = stack

  const register = useCallback((entry: OverlayEntry) => {
    setStack((current) => [...current.filter((item) => item.id !== entry.id), entry])
    return () => {
      setStack((current) => current.filter((item) => item.id !== entry.id))
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const top = stackRef.current.at(-1)
      if (!top?.escapeAllowed()) return
      event.preventDefault()
      event.stopPropagation()
      top.requestClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  useLayoutEffect(() => {
    if (stack.length === 0) return
    const body = document.body
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    }
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
    const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = `-${scrollX}px`
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${currentPadding + scrollbarWidth}px`
    return () => {
      Object.assign(body.style, previous)
      window.scrollTo(scrollX, scrollY)
    }
  }, [stack.length > 0])

  const value = useMemo<OverlayContextValue>(() => ({
    register,
    isTop: (id) => stack.at(-1)?.id === id,
    hasOverlay: stack.length > 0,
  }), [register, stack])

  return (
    <OverlayContext.Provider value={value}>
      <div
        className="overlay-app-root"
        aria-hidden={value.hasOverlay ? 'true' : undefined}
        inert={value.hasOverlay}
      >
        {children}
      </div>
    </OverlayContext.Provider>
  )
}

export interface DialogBaseProps extends PropsWithChildren {
  title: string
  description?: string
  variant: 'modal' | 'drawer' | 'palette'
  onClose: () => void
  footer?: ReactNode
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  closeDisabled?: boolean
  closeLabel?: string
  titleVisibility?: 'visible' | 'sr-only'
  showClose?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  dialogRef?: RefObject<HTMLElement | null>
}

export function DialogBase({
  title,
  description,
  variant,
  onClose,
  footer,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeDisabled = false,
  closeLabel = 'Закрити',
  titleVisibility = 'visible',
  showClose = true,
  initialFocusRef,
  dialogRef,
}: DialogBaseProps) {
  const context = useContext(OverlayContext)
  if (!context) throw new Error('DialogBase must be rendered inside OverlayProvider.')
  const { isTop, register } = context
  const generatedId = useId()
  const overlayId = `overlay-${generatedId.replace(/:/g, '')}`
  const titleId = `${overlayId}-title`
  const descriptionId = description ? `${overlayId}-description` : undefined
  const internalRef = useRef<HTMLElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const restoreTimerRef = useRef<number | undefined>(undefined)
  const closeRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  const closeOnEscapeRef = useRef(closeOnEscape)
  closeRef.current = onClose
  closeDisabledRef.current = closeDisabled
  closeOnEscapeRef.current = closeOnEscape
  const surfaceRef = dialogRef ?? internalRef

  useLayoutEffect(() => {
    if (restoreTimerRef.current !== undefined) {
      window.clearTimeout(restoreTimerRef.current)
      restoreTimerRef.current = undefined
    }
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    if (activeElement && !surfaceRef.current?.contains(activeElement)) {
      restoreFocusRef.current = activeElement
    }
    const unregister = register({
      id: overlayId,
      escapeAllowed: () => closeOnEscapeRef.current && !closeDisabledRef.current,
      requestClose: () => {
        if (!closeDisabledRef.current) closeRef.current()
      },
    })
    const focusTarget = initialFocusRef?.current
      ?? surfaceRef.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
      ?? surfaceRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )
      ?? surfaceRef.current
    focusTarget?.focus()
    return () => {
      unregister()
      restoreTimerRef.current = window.setTimeout(() => {
        const restoreTarget = restoreFocusRef.current
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true })
        restoreTimerRef.current = undefined
      }, 0)
    }
  }, [
    initialFocusRef,
    overlayId,
    register,
    surfaceRef,
  ])

  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !isTop(overlayId) || !surfaceRef.current) return
    const focusable = [...surfaceRef.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
    if (focusable.length === 0) {
      event.preventDefault()
      surfaceRef.current.focus()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className={`overlay-layer overlay-layer--${variant}`}
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.currentTarget === event.target
          && closeOnBackdrop
          && !closeDisabled
          && isTop(overlayId)
        ) onClose()
      }}
    >
      <section
        ref={surfaceRef}
        className={`overlay-surface overlay-surface--${variant} ${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        {titleVisibility === 'visible' ? (
          <header className="overlay__header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
            {showClose && (
              <button
                type="button"
                className="icon-button"
                aria-label={closeLabel}
                title={closeLabel}
                disabled={closeDisabled}
                onClick={onClose}
              >
                <X size={20} />
              </button>
            )}
          </header>
        ) : (
          <>
            <h2 className="sr-only" id={titleId}>{title}</h2>
            {description && <p className="sr-only" id={descriptionId}>{description}</p>}
          </>
        )}
        <div className={`overlay__body ${variant}__body`}>{children}</div>
        {footer && <footer className={`overlay__footer ${variant}__footer`}>{footer}</footer>}
      </section>
    </div>,
    document.body,
  )
}

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  closeDisabled = false,
  initialFocusRef,
}: PropsWithChildren<{
  title: string
  description?: string
  footer?: ReactNode
  onClose: () => void
  closeDisabled?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
}>) {
  return (
    <DialogBase
      title={title}
      description={description}
      variant="modal"
      onClose={onClose}
      footer={footer}
      closeDisabled={closeDisabled}
      closeOnBackdrop={!closeDisabled}
      closeOnEscape={!closeDisabled}
      initialFocusRef={initialFocusRef}
    >
      {children}
    </DialogBase>
  )
}

export function Drawer({
  title,
  children,
  onClose,
  footer,
}: PropsWithChildren<{
  title: string
  onClose: () => void
  footer?: ReactNode
}>) {
  return (
    <DialogBase title={title} variant="drawer" onClose={onClose} footer={footer}>
      {children}
    </DialogBase>
  )
}
