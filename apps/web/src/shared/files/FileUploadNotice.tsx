import { useEffect, useState } from 'react'
import { CircleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import './file-upload-notice.css'

export function FileUploadNotice() {
  const [notice, setNotice] = useState<{ message: string; key: number } | null>(null)
  useEffect(() => {
    const receive = (event: Event) => setNotice({ message: (event as CustomEvent<string>).detail, key: Date.now() })
    window.addEventListener('lankadws:file-error', receive)
    return () => window.removeEventListener('lankadws:file-error', receive)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 8_000)
    return () => window.clearTimeout(timer)
  }, [notice])
  return notice && createPortal(<div className="file-upload-notice form-error" role="alert">
    <CircleAlert size={20} aria-hidden="true" />
    <span>{notice.message}</span>
    <button type="button" aria-label="Закрити повідомлення" onClick={() => setNotice(null)}><X size={18} /></button>
  </div>, document.body)
}
