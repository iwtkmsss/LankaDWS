import { lazy, Suspense } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { notifySuccess } from '../shared/ui/notify'

// The dialog lives with the knowledge base, which owns feedback tickets; it shares that route's chunk.
const KnowledgeFeedbackDialog = lazy(() => import('../pages/ContentPages').then((module) => ({ default: module.KnowledgeFeedbackDialog })))

export const FEEDBACK_PARAM = 'feedback'

/** Search string that opens the feedback dialog over the current page. */
export function withFeedbackOpen(search: string) {
  const next = new URLSearchParams(search)
  next.set(FEEDBACK_PARAM, 'new')
  return `?${next.toString()}`
}

/** Opens the feedback dialog on any page from `?feedback=new` and confirms a sent ticket. */
export function FeedbackDialogHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = new URLSearchParams(location.search).get(FEEDBACK_PARAM) === 'new'

  const close = () => {
    const next = new URLSearchParams(location.search)
    next.delete(FEEDBACK_PARAM)
    const search = next.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash })
  }

  return <>
    {open && <Suspense fallback={null}>
      <KnowledgeFeedbackDialog onClose={close} onSubmitted={() => notifySuccess('Звернення надіслано адміністратору. Дякуємо за відгук!')} />
    </Suspense>}
  </>
}
