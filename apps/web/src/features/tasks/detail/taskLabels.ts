import type { TaskListItem } from '@lankadws/contracts'

export function taskPriorityLabel(priority: TaskListItem['priority']): string {
  return {
    LOW: 'Низький',
    MEDIUM: 'Середній',
    HIGH: 'Високий',
    CRITICAL: 'Терміновий',
  }[priority]
}
