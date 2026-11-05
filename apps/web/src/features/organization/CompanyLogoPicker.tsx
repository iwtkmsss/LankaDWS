import { useEffect, useRef, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { api } from '../../shared/api/client'
import { CompanyLogo } from './OrganizationVisuals'

export function CompanyLogoPicker({ value, src, onChange, onBusyChange, disabled = false, showPreview = true }: {
  value: string | null
  src?: string | null
  onChange: (value: string | null) => void
  onBusyChange: (busy: boolean) => void
  disabled?: boolean
  showPreview?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function upload(file: File | undefined) {
    if (!file) return
    setError('')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size) {
      setError('Виберіть PNG, JPEG або WebP до 2 МБ.')
      return
    }
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    onBusyChange(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const uploaded = await api<{ id: string }>('/admin/companies/logo-uploads', { method: 'POST', body, signal: abort.signal })
      let clean = false
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const status = await api<{ scanStatus: string }>(`/files/${uploaded.id}/status`, { signal: abort.signal })
        if (status.scanStatus === 'CLEAN') { clean = true; break }
        if (!['QUARANTINED', 'SCANNING'].includes(status.scanStatus)) throw new Error('Зображення не пройшло перевірку. Виберіть інший файл.')
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
          const timer = setTimeout(() => { abort.signal.removeEventListener('abort', cancel); resolve() }, 1000)
          abort.signal.addEventListener('abort', cancel, { once: true })
        })
      }
      if (!clean) throw new Error('Перевірка зображення триває довше, ніж очікувалось. Спробуйте ще раз.')
      setPreview(URL.createObjectURL(file))
      onChange(uploaded.id)
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не вдалося завантажити логотип.')
    } finally {
      if (!abort.signal.aborted) { setBusy(false); onBusyChange(false) }
    }
  }

  return <fieldset className="organization-logo-picker span-2" disabled={disabled}><legend className="sr-only">Логотип компанії</legend>
    <div className="organization-logo-picker__row">
      {showPreview && <span className="organization-logo-picker__preview"><CompanyLogo src={preview ?? (value ? src : null)} size={40} /></span>}
      <div className="organization-logo-picker__content">
        <input ref={fileInput} hidden aria-label="Фото або логотип" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { void upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
        <div className="organization-logo-picker__actions">
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} aria-hidden />Завантажити логотип</button>
          <button type="button" disabled={busy || !value} onClick={() => { onChange(null); setPreview(null); setError('') }}><Trash2 size={15} aria-hidden />Видалити логотип</button>
        </div>
        <small>PNG, JPEG або WebP · до 2 МБ</small>
      </div>
    </div>
    {busy && <p role="status">Завантажуємо та перевіряємо зображення…</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
