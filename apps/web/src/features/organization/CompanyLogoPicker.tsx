import { useEffect, useRef, useState } from 'react'
import { api } from '../../shared/api/client'
import { CompanyLogo } from './OrganizationVisuals'

export function CompanyLogoPicker({ value, src, onChange, onBusyChange, disabled = false }: {
  value: string | null
  src?: string | null
  onChange: (value: string | null) => void
  onBusyChange: (busy: boolean) => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
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

  return <fieldset className="organization-logo-picker span-2" disabled={disabled}><legend>Логотип компанії</legend>
    <div className="organization-logo-picker__row">
      <span className="organization-logo-picker__preview"><CompanyLogo src={preview ?? (value ? src : null)} size={64} /></span>
      <div><label>Фото або логотип<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { void upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
        <small>PNG, JPEG або WebP · до 2 МБ</small>
        {value && <button type="button" disabled={busy} onClick={() => { onChange(null); setPreview(null); setError('') }}>Видалити логотип</button>}
      </div>
    </div>
    {busy && <p role="status">Завантажуємо та перевіряємо зображення…</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
