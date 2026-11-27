import { useEffect, useId, useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type KeyboardEvent, type PropsWithChildren, type ReactNode } from 'react'
import { AlertTriangle, Check, CircleAlert, Inbox, LoaderCircle } from 'lucide-react'
import { statusLabels } from '../lib/format'
import { useTopbarContent } from '../../layout/TopbarContent'
export { DateTimePicker } from './DateTimePicker'
export { Menu, MenuItem, useDetailsMenu, clampToViewport, handleMenuNavigationKey, focusFirstMenuItem } from './Menu'
export type { MenuCloseReason, MenuProps } from './Menu'
export { Field } from './Field'

export {
  ConfirmationDialog,
  DialogBase,
  Drawer,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  ModalRoot,
  OverlayProvider,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from './Overlay'
export type {
  DialogBaseProps,
  ModalCloseReason,
  ModalRootProps,
  ModalRole,
  ModalSize,
  ModalVariant,
  ModalCloseGuardController,
} from './Overlay'

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button className={`button button--${variant} ${className}`} {...props} />
}

export function IconButton({ label, children, className = '', ...props }: ComponentPropsWithRef<'button'> & { label: string; children: ReactNode }) {
  return <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</button>
}

export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const pixels = size === 'lg' ? 48 : 32
  return <span className={`brand-mark brand-mark--${size}`} aria-hidden="true"><img src="/favicon.svg" alt="" width={pixels} height={pixels} /></span>
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`card ${className}`}>{children}</section> }

export function Avatar({ src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const imageSrc = src?.startsWith('file_')
    ? `/api/v1/me/avatar/${encodeURIComponent(src)}`
    : src
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(imageSrc && imageSrc !== failedSrc)

  return <span className={`avatar avatar--${size}${showImage ? '' : ' avatar--placeholder'}`}>
    {showImage
      ? <img src={imageSrc!} alt="" width={size === 'lg' ? 72 : size === 'sm' ? 28 : 38} height={size === 'lg' ? 72 : size === 'sm' ? 28 : 38} onError={() => setFailedSrc(imageSrc!)} />
      : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="#c8c8c8"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-5 0-9 2.5-9 5.5V21h18v-1.5c0-3-4-5.5-9-5.5Z" /></svg>}
  </span>
}

export function CompactFileName({ fileName, className = '' }: { fileName: string; className?: string }) {
  const extensionStart = fileName.lastIndexOf('.')
  const hasExtension = extensionStart > 0 && extensionStart < fileName.length - 1
  const stem = hasExtension ? fileName.slice(0, extensionStart) : fileName
  const extension = hasExtension ? fileName.slice(extensionStart) : ''

  return (
    <span className={`compact-file-name ${className}`.trim()} title={fileName}>
      <span className="compact-file-name__stem">{stem}</span>
      {extension && <span className="compact-file-name__extension">{extension}</span>}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ['DONE', 'SUCCEEDED', 'APPROVED', 'PUBLISHED', 'ACTIVE', 'READY'].includes(status) ? 'success' : ['BLOCKED', 'FAILED', 'REJECTED', 'INACTIVE'].includes(status) ? 'danger' : ['PENDING', 'RETURNED', 'QUEUED', 'SCHEDULED'].includes(status) ? 'warning' : 'info'
  const Icon = tone === 'success' ? Check : tone === 'danger' ? CircleAlert : tone === 'warning' ? AlertTriangle : LoaderCircle
  return <span className={`status status--${tone}`} data-status={status}><Icon size={13} aria-hidden />{statusLabels[status] ?? status}</span>
}

function LoaderMark() {
  return (
    <span className="page-data-loader__mark" aria-hidden="true">
      <span className="page-data-loader__glow" />
      <span className="page-data-loader__sweep" />
      <img className="page-data-loader__logo" src="/favicon.svg" alt="" width={64} height={64} />
    </span>
  )
}

/** Compact branded loader for panels, drawers and lists. `rows` is kept for call-site compatibility. */
export function Skeleton(_props: { rows?: number }) {
  return <div className="inline-data-loader" role="status" aria-label="Завантаження"><LoaderMark /></div>
}

export function PageDataLoader({ delay = 180, label = 'Завантажуємо дані' }: { delay?: number; label?: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])

  if (!visible) return <div className="page-data-loader page-data-loader--pending" aria-hidden="true" />
  return (
    <div className="page-data-loader" role="status" aria-label={label}>
      <LoaderMark />
      <span>Оновлюємо робочий простір</span>
    </div>
  )
}

type EmptyStateIllustration = 'workspace' | 'search' | 'calendar'

export function EmptyState({
  title,
  description,
  action,
  illustration,
}: {
  title: string
  description: string
  action?: ReactNode
  illustration?: EmptyStateIllustration
}) {
  return (
    <div className={`empty-state ${illustration ? 'empty-state--illustrated' : ''}`}>
      {illustration
        ? <img src={`/assets/empty-states/${illustration}.webp`} alt="" width="240" height="180" loading="lazy" />
        : <Inbox size={34} aria-hidden />}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Не вдалося завантажити дані', onRetry }: { title?: string; onRetry?: () => void }) { return <div className="empty-state empty-state--error"><CircleAlert size={34} aria-hidden /><h3>{title}</h3>{onRetry && <Button variant="secondary" onClick={onRetry}>Спробувати ще раз</Button>}</div> }

/**
 * Keyboard support for a `role="tablist"` (WAI-ARIA tabs, automatic activation): ArrowLeft/ArrowRight
 * (wrapping), Home and End move focus to the neighbouring enabled tab and activate it. Pair with
 * roving `tabIndex` (selected tab 0, others -1) on the tabs.
 */
export function handleTablistKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'))
  if (tabs.length === 0) return
  const current = tabs.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (Math.max(current, 0) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}

export function Tabs({ value, items, onChange, label }: { value: string; items: Array<{ value: string; label: string; count?: number; unreadCount?: number; /** id of the tabpanel this tab controls */ controls?: string }>; onChange: (value: string) => void; label?: string }) {
  const baseId = useId()
  return <div className="tabs" role="tablist" aria-label={label} onKeyDown={handleTablistKeyDown}>{items.map((item) => <button key={item.value} id={`${baseId}-${item.value}`} type="button" role="tab" aria-selected={value === item.value} aria-controls={item.controls} tabIndex={value === item.value ? 0 : -1} className={value === item.value ? 'is-active' : ''} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}{Boolean(item.unreadCount) && <b className="task-tab-unread" title="Непрочитані сповіщення" aria-label={`${item.unreadCount} непрочитаних сповіщень`}>{item.unreadCount! > 99 ? '99+' : item.unreadCount}</b>}</button>)}</div>
}

export function PageHeader({ title, action }: { title: string; description?: string; action?: ReactNode }) {
  useTopbarContent(action ?? null)
  return <h1 className="sr-only">{title}</h1>
}
