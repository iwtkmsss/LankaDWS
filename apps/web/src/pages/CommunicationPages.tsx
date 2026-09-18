import { useLocation } from 'react-router-dom'
import { MessagesPage } from '../features/messages/MessagesPage'
import { NotificationsPage } from './NotificationsPage'

export default function CommunicationPages() {
  const path = useLocation().pathname
  if (path.startsWith('/notifications')) return <NotificationsPage />
  return <MessagesPage />
}
