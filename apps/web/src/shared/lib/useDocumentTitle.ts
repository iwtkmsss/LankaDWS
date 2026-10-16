import { useEffect } from 'react'

export function useDocumentTitle(title: string, unreadNotifications: number) {
  useEffect(() => {
    document.title = `${unreadNotifications > 0 ? `(${unreadNotifications}) ` : ''}${title} — Lanka`
    return () => { document.title = 'Lanka' }
  }, [title, unreadNotifications])
}
