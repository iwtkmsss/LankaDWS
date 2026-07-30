import type {
  CSSProperties,
  HTMLAttributes,
  PropsWithChildren,
  ReactNode,
  RefObject,
} from 'react'
import {
  createContext,
  forwardRef,
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
import { useBlocker } from 'react-router-dom'
import { X } from 'lucide-react'

export type ModalCloseReason =
  | 'escape'
  | 'backdrop'
  | 'close-button'
  | 'cancel-button'
  | 'route-change'
  | 'success'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'
export type ModalVariant = 'modal' | 'drawer' | 'palette'
export type ModalRole = 'dialog' | 'alertdialog'

interface OverlayEntry {
  id: string
  requestClose: (reason: ModalCloseReason) => void
  escapeAllowed: () => boolean
  contains: (target: EventTarget | null) => boolean
  focus: () => void
}

interface OverlayContextValue {
  register: (entry: OverlayEntry) => () => void
  isTop: (id: string) => boolean
  indexOf: (id: string) => number
  hasOverlay: boolean
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

const focusableSelector = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function visibleFocusableElements(surface: HTMLElement): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => {
    const style = window.getComputedStyle(element)
    return (
      !element.hasAttribute('hidden')
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.closest('[inert]')
      && style.display !== 'none'
      && style.visibility !== 'hidden'
    )
  })
}

export function OverlayProvider({ children }: PropsWithChildren) {
  const [stack, setStack] = useState<OverlayEntry[]>([])
  const stackRef = useRef(stack)
  stackRef.current = stack

  const register = useCallback((entry: OverlayEntry) => {
    const next = [
      ...stackRef.current.filter((item) => item.id !== entry.id),
      entry,
    ]
    stackRef.current = next
    setStack(next)
    return () => {
      const remaining = stackRef.current.filter((item) => item.id !== entry.id)
      stackRef.current = remaining
      setStack(remaining)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const top = stackRef.current.at(-1)
      if (!top?.escapeAllowed()) return
      event.preventDefault()
      event.stopPropagation()
      top.requestClose('escape')
    }
    const handleFocusIn = (event: FocusEvent) => {
      const top = stackRef.current.at(-1)
      if (top && !top.contains(event.target)) top.focus()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
    }
  }, [])

  const hasOverlay = stack.length > 0
  useLayoutEffect(() => {
    if (!hasOverlay) return
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
  }, [hasOverlay])

  const value = useMemo<OverlayContextValue>(() => ({
    register,
    isTop: (id) => stack.at(-1)?.id === id,
    indexOf: (id) => stack.findIndex((entry) => entry.id === id),
    hasOverlay,
  }), [hasOverlay, register, stack])

  return (
    <OverlayContext.Provider value={value}>
      <div
        className="overlay-app-root"
        aria-hidden={hasOverlay ? 'true' : undefined}
        inert={hasOverlay}
      >
        {children}
      </div>
    </OverlayContext.Provider>
  )
}

export interface ModalBackdropProps extends HTMLAttributes<HTMLDivElement> {
  variant: ModalVariant
  closing?: boolean
  inactive?: boolean
  stackIndex?: number
}

export function ModalBackdrop({
  variant,
  closing = false,
  inactive = false,
  stackIndex = 0,
  className = '',
  children,
  ...props
}: ModalBackdropProps) {
  return (
    <div
      {...props}
      className={[
        'overlay-layer',
        `overlay-layer--${variant}`,
        closing ? 'is-closing' : '',
        inactive ? 'is-inactive' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{ '--overlay-stack-index': Math.max(0, stackIndex) } as CSSProperties}
      role="presentation"
    >
      {children}
    </div>
  )
}

export interface ModalPanelProps extends HTMLAttributes<HTMLElement> {
  variant: ModalVariant
  size: ModalSize
  mobileFullscreen?: boolean
}

export const ModalPanel = forwardRef<HTMLElement, ModalPanelProps>(function ModalPanel({
  variant,
  size,
  mobileFullscreen = false,
  className = '',
  children,
  ...props
}, ref) {
  return (
    <section
      {...props}
      ref={ref}
      className={[
        'overlay-surface',
        `overlay-surface--${variant}`,
        `overlay-surface--size-${size}`,
        mobileFullscreen ? 'overlay-surface--mobile-fullscreen' : '',
        variant,
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </section>
  )
})

export function ModalCloseButton({
  label = 'Закрити',
  disabled = false,
  onClick,
}: {
  label?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="icon-button overlay__close"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <X size={20} />
    </button>
  )
}

export function ModalHeader({
  title,
  description,
  titleId,
  descriptionId,
  showClose = true,
  closeDisabled = false,
  closeLabel,
  onRequestClose,
  className = '',
  children,
}: PropsWithChildren<{
  title?: string
  description?: string
  titleId?: string
  descriptionId?: string
  showClose?: boolean
  closeDisabled?: boolean
  closeLabel?: string
  onRequestClose?: (reason: ModalCloseReason) => void
  className?: string
}>) {
  return (
    <header className={`overlay__header ${className}`.trim()}>
      {children ?? (
        <div>
          {title && <h2 id={titleId}>{title}</h2>}
          {description && <p id={descriptionId}>{description}</p>}
        </div>
      )}
      {showClose && onRequestClose && (
        <ModalCloseButton
          label={closeLabel}
          disabled={closeDisabled}
          onClick={() => onRequestClose('close-button')}
        />
      )}
    </header>
  )
}

export function ModalBody({
  variant,
  className = '',
  children,
}: PropsWithChildren<{ variant: ModalVariant; className?: string }>) {
  return (
    <div className={`overlay__body ${variant}__body ${className}`.trim()}>
      {children}
    </div>
  )
}

export function ModalFooter({
  variant,
  className = '',
  children,
}: PropsWithChildren<{ variant: ModalVariant; className?: string }>) {
  return (
    <footer className={`overlay__footer ${variant}__footer ${className}`.trim()}>
      {children}
    </footer>
  )
}

export interface ModalRootProps extends PropsWithChildren {
  title: string
  description?: string
  variant: ModalVariant
  size?: ModalSize
  mobileFullscreen?: boolean
  role?: ModalRole
  onRequestClose: (reason: ModalCloseReason) => void
  footer?: ReactNode
  header?: ReactNode
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  closeDisabled?: boolean
  closeLabel?: string
  titleVisibility?: 'visible' | 'sr-only'
  showClose?: boolean
  className?: string
  bodyClassName?: string
  headerClassName?: string
  footerClassName?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  dialogRef?: RefObject<HTMLElement | null>
}

export function ModalRoot({
  title,
  description,
  variant,
  size = 'md',
  mobileFullscreen = false,
  role = 'dialog',
  onRequestClose,
  footer,
  header,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeDisabled = false,
  closeLabel = 'Закрити',
  titleVisibility = 'visible',
  showClose = true,
  className = '',
  bodyClassName = '',
  headerClassName = '',
  footerClassName = '',
  initialFocusRef,
  dialogRef,
}: ModalRootProps) {
  const context = useContext(OverlayContext)
  if (!context) throw new Error('ModalRoot must be rendered inside OverlayProvider.')
  const { indexOf, isTop, register } = context
  const generatedId = useId()
  const overlayId = `overlay-${generatedId.replace(/:/g, '')}`
  const titleId = `${overlayId}-title`
  const descriptionId = description ? `${overlayId}-description` : undefined
  const internalRef = useRef<HTMLElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const restoreTimerRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)
  const requestCloseRef = useRef(onRequestClose)
  const closeDisabledRef = useRef(closeDisabled)
  const closeOnEscapeRef = useRef(closeOnEscape)
  requestCloseRef.current = onRequestClose
  closeDisabledRef.current = closeDisabled
  closeOnEscapeRef.current = closeOnEscape
  const surfaceRef = dialogRef ?? internalRef

  const focusSurface = useCallback(() => {
    const focusTarget = initialFocusRef?.current
      ?? surfaceRef.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
      ?? (surfaceRef.current ? visibleFocusableElements(surfaceRef.current)[0] : null)
      ?? surfaceRef.current
    focusTarget?.focus({ preventScroll: true })
  }, [initialFocusRef, surfaceRef])

  const requestClose = useCallback((reason: ModalCloseReason) => {
    if (closeDisabledRef.current || closingRef.current) return
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      requestCloseRef.current(reason)
      return
    }
    closingRef.current = true
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined
      requestCloseRef.current(reason)
      closingRef.current = false
      setClosing(false)
    }, 130)
  }, [])

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
      requestClose,
      contains: (target) => target instanceof Node && Boolean(surfaceRef.current?.contains(target)),
      focus: focusSurface,
    })
    return () => {
      unregister()
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
      restoreTimerRef.current = window.setTimeout(() => {
        const restoreTarget = restoreFocusRef.current
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true })
        restoreTimerRef.current = undefined
      }, 0)
    }
  }, [focusSurface, overlayId, register, requestClose, surfaceRef])

  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !isTop(overlayId) || !surfaceRef.current) return
    const focusable = visibleFocusableElements(surfaceRef.current)
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

  const top = isTop(overlayId)
  const stackIndex = indexOf(overlayId)
  useLayoutEffect(() => {
    if (top) focusSurface()
  }, [focusSurface, top])

  return createPortal(
    <ModalBackdrop
      variant={variant}
      closing={closing}
      inactive={!top}
      stackIndex={stackIndex}
      onMouseDown={(event) => {
        if (
          event.currentTarget === event.target
          && closeOnBackdrop
          && !closeDisabled
          && top
        ) requestClose('backdrop')
      }}
    >
      <ModalPanel
        ref={surfaceRef}
        variant={variant}
        size={size}
        mobileFullscreen={mobileFullscreen}
        className={className}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-hidden={top ? undefined : 'true'}
        inert={!top}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        {titleVisibility === 'visible' ? (
          <ModalHeader
            title={title}
            description={description}
            titleId={titleId}
            descriptionId={descriptionId}
            showClose={showClose}
            closeDisabled={closeDisabled}
            closeLabel={closeLabel}
            onRequestClose={requestClose}
            className={headerClassName}
          />
        ) : (
          <>
            <h2 className="sr-only" id={titleId}>{title}</h2>
            {description && <p className="sr-only" id={descriptionId}>{description}</p>}
          </>
        )}
        {header && (
          <ModalHeader
            showClose={false}
            className={headerClassName}
          >
            {header}
          </ModalHeader>
        )}
        <ModalBody variant={variant} className={bodyClassName}>{children}</ModalBody>
        {footer && (
          <ModalFooter variant={variant} className={footerClassName}>{footer}</ModalFooter>
        )}
      </ModalPanel>
    </ModalBackdrop>,
    document.body,
  )
}

export type DialogBaseProps = ModalRootProps

export function DialogBase(props: DialogBaseProps) {
  return <ModalRoot {...props} />
}

export function Modal({
  title,
  description,
  children,
  footer,
  onRequestClose,
  closeDisabled = false,
  initialFocusRef,
  className,
  bodyClassName,
  size = 'md',
  role = 'dialog',
  mobileFullscreen = true,
  closeOnBackdrop,
  closeOnEscape,
}: PropsWithChildren<{
  title: string
  description?: string
  footer?: ReactNode
  onRequestClose: (reason: ModalCloseReason) => void
  closeDisabled?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  bodyClassName?: string
  size?: ModalSize
  role?: ModalRole
  mobileFullscreen?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}>) {
  return (
    <ModalRoot
      title={title}
      description={description}
      variant="modal"
      size={size}
      role={role}
      mobileFullscreen={mobileFullscreen}
      onRequestClose={onRequestClose}
      footer={footer}
      closeDisabled={closeDisabled}
      className={className}
      bodyClassName={bodyClassName}
      closeOnBackdrop={closeOnBackdrop ?? !closeDisabled}
      closeOnEscape={closeOnEscape ?? !closeDisabled}
      initialFocusRef={initialFocusRef}
    >
      {children}
    </ModalRoot>
  )
}

export function Drawer({
  title,
  description,
  children,
  onRequestClose,
  footer,
  closeDisabled = false,
  initialFocusRef,
  className,
  bodyClassName,
  size = 'md',
}: PropsWithChildren<{
  title: string
  description?: string
  onRequestClose: (reason: ModalCloseReason) => void
  footer?: ReactNode
  closeDisabled?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  bodyClassName?: string
  size?: Exclude<ModalSize, 'fullscreen'>
}>) {
  return (
    <ModalRoot
      title={title}
      description={description}
      variant="drawer"
      size={size}
      mobileFullscreen
      onRequestClose={onRequestClose}
      footer={footer}
      closeDisabled={closeDisabled}
      closeOnBackdrop={!closeDisabled}
      closeOnEscape={!closeDisabled}
      initialFocusRef={initialFocusRef}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children}
    </ModalRoot>
  )
}

export function ConfirmationDialog({
  title,
  description,
  children,
  onRequestClose,
  onConfirm,
  confirmLabel = 'Підтвердити',
  cancelLabel = 'Скасувати',
  confirmVariant = 'danger',
  confirmDisabled = false,
  footer,
  initialFocusRef,
}: PropsWithChildren<{
  title: string
  description?: string
  onRequestClose: (reason: ModalCloseReason) => void
  onConfirm?: () => void
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'danger'
  confirmDisabled?: boolean
  footer?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
}>) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const actions = footer ?? (
    <>
      <button
        ref={cancelRef}
        type="button"
        className="button button--secondary"
        onClick={() => onRequestClose('cancel-button')}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        className={`button button--${confirmVariant}`}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </>
  )
  return (
    <Modal
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      mobileFullscreen={false}
      onRequestClose={onRequestClose}
      initialFocusRef={initialFocusRef ?? cancelRef}
      footer={actions}
    >
      {children}
    </Modal>
  )
}

export function useModalCloseGuard({
  dirty,
  onRequestClose,
}: {
  dirty: boolean
  onRequestClose: (reason: ModalCloseReason) => void
}) {
  const dirtyRef = useRef(dirty)
  const closeRef = useRef(onRequestClose)
  const allowNavigationRef = useRef(false)
  const pendingReasonRef = useRef<ModalCloseReason | null>(null)
  dirtyRef.current = dirty
  closeRef.current = onRequestClose
  const [pendingReason, setPendingReason] = useState<ModalCloseReason | null>(null)
  const blocker = useBlocker(useCallback(() => (
    dirtyRef.current && !allowNavigationRef.current
  ), []))
  const resetNavigationAllowance = useCallback(() => {
    window.setTimeout(() => {
      allowNavigationRef.current = false
    }, 0)
  }, [])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    pendingReasonRef.current = 'route-change'
    setPendingReason('route-change')
  }, [blocker.state])

  const requestClose = useCallback((reason: ModalCloseReason) => {
    if (reason === 'success' || !dirtyRef.current) {
      allowNavigationRef.current = true
      closeRef.current(reason)
      resetNavigationAllowance()
      return
    }
    pendingReasonRef.current = reason
    setPendingReason(reason)
  }, [resetNavigationAllowance])

  const cancelClose = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset()
    pendingReasonRef.current = null
    setPendingReason(null)
  }, [blocker])

  const confirmClose = useCallback((beforeClose?: () => void) => {
    beforeClose?.()
    const reason = pendingReasonRef.current ?? 'cancel-button'
    pendingReasonRef.current = null
    setPendingReason(null)
    allowNavigationRef.current = true
    if (reason === 'route-change' && blocker.state === 'blocked') {
      blocker.proceed()
      resetNavigationAllowance()
      return
    }
    closeRef.current(reason)
    resetNavigationAllowance()
  }, [blocker, resetNavigationAllowance])

  const closeForSuccess = useCallback((action: () => void) => {
    allowNavigationRef.current = true
    action()
    resetNavigationAllowance()
  }, [resetNavigationAllowance])

  return {
    requestClose,
    pendingReason,
    isConfirmationOpen: pendingReason !== null,
    cancelClose,
    confirmClose,
    closeForSuccess,
  }
}

export type ModalCloseGuardController = ReturnType<typeof useModalCloseGuard>

export function UnsavedChangesDialog({
  guard,
  title = 'Закрити без збереження?',
  description = 'Незбережені зміни буде втрачено.',
}: {
  guard: ModalCloseGuardController
  title?: string
  description?: string
}) {
  if (!guard.isConfirmationOpen) return null
  return (
    <ConfirmationDialog
      title={title}
      description={description}
      cancelLabel="Продовжити редагування"
      confirmLabel="Закрити без збереження"
      onRequestClose={() => guard.cancelClose()}
      onConfirm={() => guard.confirmClose()}
    >
      <p>Перевірте введені дані або поверніться до форми.</p>
    </ConfirmationDialog>
  )
}
