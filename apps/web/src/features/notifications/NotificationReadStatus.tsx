import './notification-read-state.css'

export function NotificationReadStatus({ readAt }: { readAt: string | null }) {
  return <span className="notification-read-status">{readAt ? 'Прочитано' : 'Нове'}</span>
}
