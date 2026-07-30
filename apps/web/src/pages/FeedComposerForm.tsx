import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  FeedAttachmentView,
  FeedAudienceOption,
} from '@bert-crm/contracts'
import {
  CalendarPlus2,
  CheckCircle2,
  FileText,
  FileUp,
  Paperclip,
  Send,
} from 'lucide-react'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { Button } from '../shared/ui'

export function FeedComposerForm({
  company,
  canShareFiles,
  onPostCreated,
  onFeedChanged,
  onBusyChange,
  onDirtyChange,
  onNavigate,
}: {
  company: string
  canShareFiles: boolean
  onPostCreated: () => void
  onFeedChanged: () => void
  onBusyChange: (busy: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  onNavigate: (path: string) => void
}) {
  const [body, setBody] = useState('')
  const [audienceKey, setAudienceKey] = useState('')
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false)
  const [attachments, setAttachments] = useState<FeedAttachmentView[]>([])
  const [uploading, setUploading] = useState(false)
  const [sharingFile, setSharingFile] = useState(false)
  const [message, setMessage] = useState('')
  const audiences = useQuery({
    queryKey: ['feed-audiences', company],
    queryFn: () => api<{ items: FeedAudienceOption[] }>(
      `/feed/audiences?company=${encodeURIComponent(company)}`,
    ),
    enabled: company !== 'all',
  })
  const create = useMutation({
    mutationFn: (input: {
      companyId: string
      body: string
      audience: { type: 'COMPANY' } | { type: 'GROUP'; groupId: string }
      requiresAcknowledgement: boolean
      attachmentIds: string[]
    }) => api('/feed', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey('feed-post') },
      body: jsonBody(input),
    }),
    onSuccess: () => {
      setBody('')
      setAudienceKey('')
      setRequiresAcknowledgement(false)
      setAttachments([])
      setMessage('')
      onFeedChanged()
      onPostCreated()
    },
  })
  const busy = create.isPending || uploading || sharingFile
  const dirty = Boolean(
    body.trim()
    || audienceKey
    || requiresAcknowledgement
    || attachments.length,
  )

  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const options = audiences.data?.items ?? []
  const selectedKey = audienceKey || (options[0] ? `${options[0].type}:${options[0].id}` : '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const option = options.find((item) => `${item.type}:${item.id}` === selectedKey)
    if (!option || !body.trim()) return
    setMessage('')
    await create.mutateAsync({
      companyId: company,
      body: body.trim(),
      audience: option.type === 'GROUP'
        ? { type: 'GROUP', groupId: option.id }
        : { type: 'COMPANY' },
      requiresAcknowledgement,
      attachmentIds: attachments.map((attachment) => attachment.id),
    }).catch(() => {
      setMessage('Не вдалося опублікувати. Перевірте дані та спробуйте ще раз.')
    })
  }

  async function uploadSelected(files: FileList | null) {
    if (!files?.length) return
    const remaining = Math.max(0, 10 - attachments.length)
    const selected = [...files].slice(0, remaining)
    if (selected.length === 0) {
      setMessage('До однієї публікації можна додати не більше 10 файлів.')
      return
    }
    setUploading(true)
    setMessage('')
    try {
      const uploaded: FeedAttachmentView[] = []
      for (const file of selected) {
        const form = new FormData()
        form.append('file', file)
        uploaded.push(await api<FeedAttachmentView>(
          `/feed/attachments?company=${encodeURIComponent(company)}`,
          { method: 'POST', body: form },
        ))
      }
      setAttachments((current) => [...current, ...uploaded])
    } catch {
      setMessage('Не вдалося додати файл. Перевірте формат і розмір.')
    } finally {
      setUploading(false)
    }
  }

  async function shareSelected(fileList: FileList | null) {
    const file = fileList?.[0]
    const option = options.find((item) => `${item.type}:${item.id}` === selectedKey)
    if (!file || !option) {
      setMessage('Спочатку оберіть точну аудиторію файлу.')
      return
    }
    setSharingFile(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      const uploaded = await api<FeedAttachmentView>(
        `/feed/attachments?company=${encodeURIComponent(company)}`,
        { method: 'POST', body: form },
      )
      await api(`/feed/file-shares/${encodeURIComponent(uploaded.id)}`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey('feed-file-share') },
        body: jsonBody({
          companyId: company,
          audience: option.type === 'GROUP'
            ? { type: 'GROUP', groupId: option.id }
            : { type: 'COMPANY' },
        }),
      })
      setMessage('Файл поширено. Завантаження відкриється після безпечної перевірки.')
      onFeedChanged()
    } catch {
      setMessage('Не вдалося поширити файл. Перевірте доступ, формат і розмір.')
    } finally {
      setSharingFile(false)
    }
  }

  return (
    <form className="feed-composer" onSubmit={(event) => void submit(event)}>
      <label className="feed-composer__body">
        <span>Текст публікації</span>
        <textarea
          data-autofocus
          value={body}
          maxLength={10_000}
          rows={5}
          placeholder="Коротко опишіть оновлення, рішення або потрібну дію…"
          disabled={busy}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      {attachments.length > 0 && (
        <div className="feed-composer__attachments" aria-label="Додані файли">
          {attachments.map((attachment) => (
            <span key={attachment.id}>
              <FileText size={15} />
              <span>
                <strong>{attachment.fileName}</strong>
                <small>{formatBytes(attachment.bytes)} · перевіряється</small>
              </span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Прибрати ${attachment.fileName}`}
                onClick={() => setAttachments((current) =>
                  current.filter((item) => item.id !== attachment.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="feed-composer__controls">
        <label>
          <span>Хто побачить</span>
          <select
            value={selectedKey}
            disabled={busy || audiences.isLoading || options.length === 0}
            onChange={(event) => setAudienceKey(event.target.value)}
          >
            {options.map((option) => (
              <option key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}>
                {option.type === 'GROUP' ? `Група · ${option.label}` : option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="feed-ack-option">
          <input
            type="checkbox"
            checked={requiresAcknowledgement}
            disabled={busy}
            onChange={(event) => setRequiresAcknowledgement(event.target.checked)}
          />
          <span>
            <strong>Потрібне підтвердження</strong>
            <small>Кожен адресат має натиснути окрему кнопку</small>
          </span>
        </label>
        <Button disabled={!body.trim() || !selectedKey || busy}>
          <Send size={16} /> {create.isPending ? 'Публікуємо…' : 'Опублікувати'}
        </Button>
      </div>
      <footer>
        <div className="feed-composer__file-actions">
          <label className="feed-attachment-picker">
            <Paperclip size={15} />
            {uploading ? 'Додаємо…' : 'Додати файл'}
            <input
              type="file"
              multiple
              disabled={busy || attachments.length >= 10}
              onChange={(event) => {
                void uploadSelected(event.target.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          {canShareFiles && (
            <label className="feed-file-share-picker" title="Окрема картка без текстової публікації">
              <FileUp size={15} />
              {sharingFile ? 'Поширюємо…' : 'Поширити файл'}
              <input
                type="file"
                disabled={busy || !selectedKey}
                onChange={(event) => {
                  void shareSelected(event.target.files)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          )}
        </div>
        <div className="feed-composer__secondary-actions" aria-label="Інші дії">
          <button type="button" disabled={busy} onClick={() => onNavigate('/tasks/new')}>
            <CheckCircle2 size={15} /> Створити завдання
          </button>
          <button type="button" disabled={busy} onClick={() => onNavigate('/calendar?new=1')}>
            <CalendarPlus2 size={15} /> Додати подію
          </button>
        </div>
        {message && <span role="status">{message}</span>}
      </footer>
    </form>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
