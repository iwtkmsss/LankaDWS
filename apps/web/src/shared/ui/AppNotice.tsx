import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { ApiProblem } from '../api/client'
import { FILE_ERROR_EVENT, NOTICE_EVENT, type NoticeDetail } from './notify'
import './app-notice.css'

const DURATION_MS = { success: 4_000, undo: 8_000, error: 8_000 } as const

function undoFailure(error: unknown): string {
  const status = error instanceof ApiProblem ? error.problem.status : undefined
  if (status === 409) return 'Не вдалося скасувати: запис уже змінено. Оновіть сторінку'
  if (status === 403) return 'Не вдалося скасувати: час на скасування минув'
  if (status === 404) return 'Не вдалося скасувати: запис недоступний'
  return 'Не вдалося скасувати дію'
}

/** Single app-wide pop-up for action results; a newer notice replaces the current one. */
export function AppNotice() {
  const [notice, setNotice] = useState<(NoticeDetail & { key: number }) | null>(null)
  const [undoing, setUndoing] = useState(false)
  useEffect(() => {
    const show = (detail: NoticeDetail) => { setUndoing(false); setNotice({ ...detail, key: Date.now() }) }
    const receive = (event: Event) => show((event as CustomEvent<NoticeDetail>).detail)
    const receiveFileError = (event: Event) => show({ tone: 'error', message: (event as CustomEvent<string>).detail })
    window.addEventListener(NOTICE_EVENT, receive)
    window.addEventListener(FILE_ERROR_EVENT, receiveFileError)
    return () => {
      window.removeEventListener(NOTICE_EVENT, receive)
      window.removeEventListener(FILE_ERROR_EVENT, receiveFileError)
    }
  }, [])
  useEffect(() => {
    if (!notice || undoing) return
    const timer = window.setTimeout(() => setNotice(null), DURATION_MS[notice.undo ? 'undo' : notice.tone])
    return () => window.clearTimeout(timer)
  }, [notice, undoing])
  if (!notice) return null
  const success = notice.tone === 'success'
  const undo = async () => {
    if (!notice.undo) return
    setUndoing(true)
    try {
      await notice.undo()
      setUndoing(false)
      setNotice({ tone: 'success', message: 'Дію скасовано', key: Date.now() })
    } catch (error) {
      setUndoing(false)
      setNotice({ tone: 'error', message: undoFailure(error), key: Date.now() })
    }
  }
  return createPortal(<div key={notice.key} className={`app-notice app-notice--${notice.tone}`} role={success ? 'status' : 'alert'}>
    {success ? <CircleCheck size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}
    <span>{notice.message}</span>
    {notice.undo && <button type="button" className="app-notice__undo" disabled={undoing} onClick={() => void undo()}>
      {undoing && <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />}Скасувати
    </button>}
    <button type="button" aria-label="Закрити повідомлення" onClick={() => setNotice(null)}><X size={18} /></button>
  </div>, document.body)
}
