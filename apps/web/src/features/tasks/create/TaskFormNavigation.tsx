import {
  CalendarClock,
  CheckSquare2,
  Link2,
  ListChecks,
  Users,
} from 'lucide-react'
import type { TaskCreateSection } from './types'

const items = [
  { value: 'main', label: 'Основне', Icon: CheckSquare2 },
  { value: 'participants', label: 'Учасники', Icon: Users },
  { value: 'checklist', label: 'Чек-ліст', Icon: ListChecks },
  { value: 'planning', label: 'Планування', Icon: CalendarClock },
  { value: 'relations', label: 'Зв’язки', Icon: Link2 },
] satisfies Array<{
  value: TaskCreateSection
  label: string
  Icon: typeof CheckSquare2
}>

export function TaskFormNavigation({
  value,
  onChange,
}: {
  value: TaskCreateSection
  onChange: (value: TaskCreateSection) => void
}) {
  return (
    <nav className="task-create-nav" aria-label="Розділи форми">
      {items.map(({ value: itemValue, label, Icon }) => (
        <button
          type="button"
          key={itemValue}
          className={value === itemValue ? 'is-active' : ''}
          aria-current={value === itemValue ? 'step' : undefined}
          onClick={() => onChange(itemValue)}
        >
          <Icon size={17} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
