import { useLocation } from 'react-router-dom'
import { MessagesPage } from '../features/messages/MessagesPage'
import {
  AnnouncementsPage,
  NotificationsPage,
} from './CommunicationStaticPages'

export default function CommunicationPages() {
  const path = useLocation().pathname
  if (path.startsWith('/announcements')) return <AnnouncementsPage />
  if (path.startsWith('/notifications')) return <NotificationsPage />
  return <MessagesPage />
}
