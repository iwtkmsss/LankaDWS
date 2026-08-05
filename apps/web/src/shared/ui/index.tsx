import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { AlertTriangle, Check, CircleAlert, Inbox, LoaderCircle } from 'lucide-react'
import { statusLabels } from '../lib/format'

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

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</button>
}

export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const pixels = size === 'lg' ? 48 : 32
  return <span className={`brand-mark brand-mark--${size}`} aria-hidden="true"><img src="/favicon.svg" alt="" width={pixels} height={pixels} /></span>
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`card ${className}`}>{children}</section> }

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <span className={`avatar avatar--${size}`}>{src ? <img src={src} alt="" width={size === 'lg' ? 72 : size === 'sm' ? 28 : 38} height={size === 'lg' ? 72 : size === 'sm' ? 28 : 38} /> : initials}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ['DONE', 'SUCCEEDED', 'APPROVED', 'PUBLISHED', 'ACTIVE', 'READY'].includes(status) ? 'success' : ['BLOCKED', 'FAILED', 'REJECTED', 'INACTIVE'].includes(status) ? 'danger' : ['PENDING', 'RETURNED', 'QUEUED', 'SCHEDULED'].includes(status) ? 'warning' : 'info'
  const Icon = tone === 'success' ? Check : tone === 'danger' ? CircleAlert : tone === 'warning' ? AlertTriangle : LoaderCircle
  return <span className={`status status--${tone}`}><Icon size={13} aria-hidden />{statusLabels[status] ?? status}</span>
}

export function Skeleton({ rows = 4 }: { rows?: number }) { return <div className="skeleton-stack" role="status" aria-label="Завантаження">{Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-row" />)}</div> }

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

export function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string; count?: number }>; onChange: (value: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={value === item.value ? 'is-active' : ''} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <header className="page-header"><div><h1 tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</div>{action}</header> }
