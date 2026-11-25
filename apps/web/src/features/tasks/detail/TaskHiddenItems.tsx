import type { TaskHiddenBy } from '@lankadws/contracts'
import { RotateCcw } from 'lucide-react'
import { formatDateTime } from '../../../shared/lib/format'
import { personName } from '../../../shared/lib/personName'
import { Button } from '../../../shared/ui'

/** «Видалено <хто>, <коли>» for a hidden record (decision 2026-11-18). */
export function hiddenByLabel(item: { deletedAt: string; deletedBy: TaskHiddenBy }): string {
  const who = item.deletedBy ? personName(item.deletedBy.displayName) : 'недоступним користувачем'
  return `Видалено ${who}, ${formatDateTime(item.deletedAt)}`
}

/**
 * Collapsed «Видалені (N)» area an administrator uses to restore hidden task
 * records. Renders nothing when there is nothing hidden.
 */
export function TaskHiddenItems({
  label,
  items,
  pending,
  onRestore,
}: {
  label: string
  items: Array<{ id: string; title: string; deletedAt: string; deletedBy: TaskHiddenBy }>
  pending: boolean
  onRestore: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <details className="task-hidden-items">
      <summary>Видалені ({items.length})</summary>
      <ul aria-label={label}>
        {items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.title}</strong>
              <small>{hiddenByLabel(item)}</small>
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              aria-label={`Відновити «${item.title}»`}
              onClick={() => onRestore(item.id)}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Відновити
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )
}
