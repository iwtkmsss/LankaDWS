import { Check, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'

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
  const [sent, setSent] = useState(false)
  const open = new URLSearchParams(location.search).get(FEEDBACK_PARAM) === 'new'

  useEffect(() => {
    if (!sent) return
    const timer = window.setTimeout(() => setSent(false), 6_000)
    return () => window.clearTimeout(timer)
  }, [sent])

  const close = () => {
    const next = new URLSearchParams(location.search)
    next.delete(FEEDBACK_PARAM)
    const search = next.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash })
  }

  return <>
    {open && <Suspense fallback={null}>
      <KnowledgeFeedbackDialog onClose={close} onSubmitted={() => setSent(true)} />
    </Suspense>}
    {sent && createPortal(<div className="feedback-sent-notice" role="status">
      <Check size={20} aria-hidden="true" />
      <span>Звернення надіслано адміністратору. Дякуємо за відгук!</span>
      <button type="button" aria-label="Закрити повідомлення" onClick={() => setSent(false)}><X size={18} /></button>
    </div>, document.body)}
  </>
}
