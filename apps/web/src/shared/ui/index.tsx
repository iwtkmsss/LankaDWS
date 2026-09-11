import { useEffect, useId, useState, type ButtonHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react'
import { AlertTriangle, Check, CircleAlert, Inbox, LoaderCircle } from 'lucide-react'
import { statusLabels } from '../lib/format'
import { useTopbarContent } from '../../layout/TopbarContent'

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
  return <span className={`status status--${tone}`}><Icon size={13} aria-hidden />{statusLabels[status] ?? status}</span>
}

export function Skeleton({ rows = 4 }: { rows?: number }) { return <div className="skeleton-stack" role="status" aria-label="Завантаження">{Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-row" />)}</div> }

export function PageDataLoader({ delay = 180 }: { delay?: number }) {
  const [visible, setVisible] = useState(false)
  const loaderId = useId().replace(/:/g, '')
  const orbitGradientId = `lankadws-loader-orbit-${loaderId}`
  const lockGradientId = `lankadws-loader-lock-${loaderId}`
  const markFilterId = `lankadws-loader-mark-${loaderId}`
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])

  if (!visible) return <div className="page-data-loader page-data-loader--pending" aria-hidden="true" />
  return (
    <div className="page-data-loader" role="status" aria-label="Завантажуємо дані">
      <span className="page-data-loader__mark" aria-hidden="true">
        <span className="page-data-loader__halo" />
        <svg className="page-data-loader__orbit" viewBox="0 0 100 100">
          <defs>
            <linearGradient id={orbitGradientId} x1="0" x2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".54" stopColor="#bcd8ff" stopOpacity=".58" />
              <stop offset="1" stopColor="#fff" stopOpacity=".96" />
            </linearGradient>
            <linearGradient id={lockGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".98" />
              <stop offset=".52" stopColor="#9ac6ff" stopOpacity=".88" />
              <stop offset="1" stopColor="#297eff" stopOpacity=".18" />
            </linearGradient>
          </defs>
          <ellipse className="page-data-loader__orbit-base" cx="50" cy="50" rx="43" ry="36" />
          <ellipse className="page-data-loader__orbit-soft" cx="50" cy="50" rx="47" ry="40" />
          <ellipse className="page-data-loader__orbit-bloom" cx="50" cy="50" rx="43" ry="36" pathLength="100" style={{ stroke: `url(#${orbitGradientId})` }} />
          <ellipse className="page-data-loader__orbit-tail" cx="50" cy="50" rx="43" ry="36" pathLength="100" />
          <ellipse className="page-data-loader__orbit-chase" cx="50" cy="50" rx="43" ry="36" pathLength="100" style={{ stroke: `url(#${orbitGradientId})` }} />
          <line className="page-data-loader__lock-beam" x1="50" y1="15.5" x2="50" y2="36.5" pathLength="1" style={{ stroke: `url(#${lockGradientId})` }} />
          <circle className="page-data-loader__orbit-node page-data-loader__orbit-node--one" cx="50" cy="14" r="1.05" />
          <circle className="page-data-loader__orbit-node page-data-loader__orbit-node--two" cx="86" cy="70" r="1.05" />
          <circle className="page-data-loader__orbit-node page-data-loader__orbit-node--three" cx="15" cy="71" r="1.05" />
        </svg>
        <span className="page-data-loader__core">
          <i className="page-data-loader__core-aura" />
          <svg className="page-data-loader__brand-mark" viewBox="0 0 1238 1233">
            <defs>
              <filter id={markFilterId} colorInterpolationFilters="sRGB" x="-25%" y="-25%" width="150%" height="150%">
                <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 3 3 3 0 -7.1" />
              </filter>
            </defs>
            <image href="/favicon.svg" width="1238" height="1233" filter={`url(#${markFilterId})`} />
          </svg>
          <svg className="page-data-loader__brand-flash" viewBox="0 0 1238 1233">
            <image href="/favicon.svg" width="1238" height="1233" filter={`url(#${markFilterId})`} />
          </svg>
        </span>
      </span>
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

export function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string; count?: number }>; onChange: (value: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={value === item.value ? 'is-active' : ''} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>
}

export function PageHeader({ title, action }: { title: string; description?: string; action?: ReactNode }) {
  useTopbarContent(action ?? null)
  return <h1 className="sr-only">{title}</h1>
}
