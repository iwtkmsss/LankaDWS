import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { AlertTriangle, Check, CircleAlert, Inbox, LoaderCircle, X } from 'lucide-react'
import { statusLabels } from '../lib/format'

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button className={`button button--${variant} ${className}`} {...props} />
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`card ${className}`}>{children}</section> }

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <span className={`avatar avatar--${size}`}>{src ? <img src={src} alt="" width={size === 'lg' ? 72 : size === 'sm' ? 28 : 38} height={size === 'lg' ? 72 : size === 'sm' ? 28 : 38} /> : initials}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ['DONE', 'SUCCEEDED', 'APPROVED', 'PUBLISHED', 'ACTIVE'].includes(status) ? 'success' : ['BLOCKED', 'FAILED', 'REJECTED', 'DEACTIVATED'].includes(status) ? 'danger' : ['PENDING', 'RETURNED', 'QUEUED', 'SCHEDULED', 'PENDING_FIRST_LOGIN'].includes(status) ? 'warning' : 'info'
  const Icon = tone === 'success' ? Check : tone === 'danger' ? CircleAlert : tone === 'warning' ? AlertTriangle : LoaderCircle
  return <span className={`status status--${tone}`}><Icon size={13} aria-hidden />{statusLabels[status] ?? status}</span>
}

export function Skeleton({ rows = 4 }: { rows?: number }) { return <div className="skeleton-stack" aria-label="Завантаження">{Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-row" />)}</div> }

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="empty-state"><Inbox size={34} aria-hidden /><h3>{title}</h3><p>{description}</p>{action}</div> }

export function ErrorState({ title = 'Не вдалося завантажити дані', onRetry }: { title?: string; onRetry?: () => void }) { return <div className="empty-state empty-state--error"><CircleAlert size={34} aria-hidden /><h3>{title}</h3>{onRetry && <Button variant="secondary" onClick={onRetry}>Спробувати ще раз</Button>}</div> }

export function Drawer({ title, children, onClose, footer }: PropsWithChildren<{ title: string; onClose: () => void; footer?: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !ref.current) return
      const focusable = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) { event.preventDefault(); ref.current.focus(); return }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', handle)
    return () => { window.removeEventListener('keydown', handle); previous?.focus() }
  }, [onClose])
  return <div className="drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><h2>{title}</h2><IconButton label="Закрити" onClick={onClose}><X size={20} /></IconButton></header><div className="drawer__body">{children}</div>{footer && <footer className="drawer__footer">{footer}</footer>}</aside></div>
}

export function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string; count?: number }>; onChange: (value: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={value === item.value ? 'is-active' : ''} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <header className="page-header"><div><h1 tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</div>{action}</header> }
