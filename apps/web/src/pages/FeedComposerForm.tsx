import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  FeedAttachmentView,
  FeedAudienceOption,
  StructuredMentionInput,
} from '@lankadws/contracts'
import {
  ChevronDown,
  FileText,
  Paperclip,
  Send,
} from 'lucide-react'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { Button, ConfirmationDialog } from '../shared/ui'
import { FileDropOverlay, useFileDropTarget } from '../shared/files/FileDropzone'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../shared/mentions/mentionText'

export function FeedComposerForm({
  defaultCompanyId,
  onPostCreated,
  onFeedChanged,
  onBusyChange,
  onDirtyChange,
}: {
  defaultCompanyId: string | null | undefined
  onPostCreated: () => void
  onFeedChanged: () => void
  onBusyChange: (busy: boolean) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<StructuredMentionInput[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[] | null>(null)
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false)
  const [attachments, setAttachments] = useState<FeedAttachmentView[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmFileOnly, setConfirmFileOnly] = useState(false)
  const [message, setMessage] = useState('')
  const attachmentControlRef = useRef<HTMLDivElement>(null)
  const audiences = useQuery({
    queryKey: ['feed-audiences', 'all'],
    queryFn: () => api<{ items: FeedAudienceOption[] }>(
      '/feed/audiences?company=all',
    ),
  })
  const create = useMutation({
    mutationFn: (input: {
      companyId: string
      body: string
      audience: { type: 'COMPANIES'; companyIds: string[] }
      requiresAcknowledgement: boolean
      attachmentIds: string[]
      mentions: StructuredMentionInput[]
    }) => api('/feed', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey('feed-post') },
      body: jsonBody(input),
    }),
    onSuccess: () => {
      setBody('')
      setMentions([])
      setSelectedCompanyIds(null)
      setRequiresAcknowledgement(false)
      setAttachments([])
      setMessage('')
      onFeedChanged()
      onPostCreated()
    },
  })
  const busy = create.isPending || uploading
  const dirty = Boolean(
    body.trim()
    || selectedCompanyIds !== null
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

  useEffect(() => {
    if (!attachmentsOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!attachmentControlRef.current?.contains(event.target as Node)) setAttachmentsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttachmentsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [attachmentsOpen])

  const companies = (audiences.data?.items ?? []).filter((item) => item.type === 'COMPANY')
  const defaultCompanyIds = defaultCompanyId && companies.some((item) => item.companyId === defaultCompanyId)
    ? [defaultCompanyId]
    : []
  const effectiveCompanyIds = selectedCompanyIds ?? defaultCompanyIds
  const selectedCompanies = companies.filter((item) => effectiveCompanyIds.includes(item.companyId))
  const primaryCompany = selectedCompanies[0]
  const audienceSummary = selectedCompanies.length === companies.length && companies.length > 0
    ? 'Усі'
    : selectedCompanies.length > 0
      ? selectedCompanies.map((item) => item.label).join(', ')
      : 'Ніхто'
  const mentionCandidateUrl = selectedCompanies.length === 1
    ? `/feed/mention-candidates?${new URLSearchParams({
        company: selectedCompanies[0].companyId,
        audienceType: 'COMPANY',
      })}`
    : null

  async function publish() {
    const prepared = trimMentionValue(body, mentions)
    if (!primaryCompany || (!prepared.body && attachments.length === 0)) return
    setMessage('')
    await create.mutateAsync({
      companyId: primaryCompany.companyId,
      body: prepared.body,
      audience: { type: 'COMPANIES', companyIds: selectedCompanies.map((item) => item.companyId) },
      requiresAcknowledgement,
      attachmentIds: attachments.map((attachment) => attachment.id),
      mentions: prepared.mentions,
    }).catch(() => {
      setMessage('Не вдалося опублікувати. Перевірте дані та спробуйте ще раз.')
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const prepared = trimMentionValue(body, mentions)
    if (!primaryCompany || (!prepared.body && attachments.length === 0)) return
    if (!prepared.body) {
      setConfirmFileOnly(true)
      return
    }
    void publish()
  }

  async function uploadSelected(files: FileList | File[] | null) {
    if (!files?.length) return
    if (!primaryCompany) {
      setMessage('Спочатку оберіть, хто побачить публікацію.')
      return
    }
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
          `/feed/attachments?company=${encodeURIComponent(primaryCompany.companyId)}`,
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

  const { isDragging, dropTargetProps } = useFileDropTarget({
    disabled: busy || !primaryCompany || attachments.length >= 10,
    onFiles: (files) => void uploadSelected(files),
  })

  return (
    <form className="feed-composer is-file-drop-target" onSubmit={submit} {...dropTargetProps}>
      <FileDropOverlay active={isDragging} label="Відпустіть файли, щоб прикріпити до публікації" />
      <MentionTextarea
        className="feed-composer__body"
        label="Текст публікації"
        value={body}
        mentions={mentions}
        candidateUrl={mentionCandidateUrl}
        maxLength={10_000}
        rows={5}
        placeholder="Коротко опишіть оновлення, рішення або потрібну дію…"
        disabled={busy}
        autoFocus
        onChange={(nextBody, nextMentions) => {
          setBody(nextBody)
          setMentions(nextMentions)
        }}
      />
      <div className="feed-composer__controls">
        <div
          ref={attachmentControlRef}
          className={`feed-attachment-control${attachmentsOpen ? ' is-open' : ''}`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAttachmentsOpen(false)
          }}
        >
          <label className="feed-attachment-picker" title="Виберіть файли або перетягніть їх у форму">
            <Paperclip size={17} />
            <span>
              <strong>{uploading ? 'Додаємо файли…' : 'Додати файли'}</strong>
              <small>
                {attachments.length > 0
                  ? `${attachments.length} із 10 прикріплено`
                  : 'Перетягніть файли сюди або виберіть їх'}
              </small>
            </span>
            <input
              aria-label="Додати файл"
              type="file"
              multiple
              disabled={busy || !primaryCompany || attachments.length >= 10}
              onChange={(event) => {
                void uploadSelected(event.target.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <button
            className="feed-attachment-control__toggle"
            type="button"
            aria-label="Показати прикріплені файли"
            aria-expanded={attachmentsOpen}
            onClick={() => setAttachmentsOpen((current) => !current)}
          >
            <ChevronDown size={17} />
          </button>
          {attachmentsOpen && (
            <div className="feed-composer__attachments" aria-label="Додані файли">
              {attachments.length > 0 ? attachments.map((attachment) => (
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
              )) : (
                <span className="feed-composer__attachments-empty">Файлів ще немає</span>
              )}
            </div>
          )}
        </div>
        <label className="feed-ack-option">
          <input
            type="checkbox"
            checked={requiresAcknowledgement}
            disabled={busy}
            onChange={(event) => setRequiresAcknowledgement(event.target.checked)}
          />
          <span>
            <strong>Пункт «Ознайомився»</strong>
            <small>Адресати підтверджують окремо</small>
          </span>
        </label>
        <Button disabled={!primaryCompany || busy || (!body.trim() && attachments.length === 0)}>
          <Send size={16} /> {create.isPending ? 'Публікуємо…' : 'Опублікувати'}
        </Button>
      </div>
      <footer>
        <div className={`feed-audience-select${audienceOpen ? ' is-open' : ''}`}>
          <button
            className="feed-audience-select__trigger"
            type="button"
            disabled={busy}
            aria-expanded={audienceOpen}
            onClick={() => setAudienceOpen((current) => !current)}
          >
            <ChevronDown size={16} />
            <span>Бачать: <strong>{audiences.isLoading ? 'завантаження…' : audienceSummary}</strong></span>
          </button>
          {audienceOpen && (
            <fieldset className="feed-company-audience" disabled={busy || audiences.isLoading}>
              <legend className="sr-only">Хто побачить</legend>
              {companies.length > 0 ? companies.map((option) => (
                <label key={option.companyId} title={option.label}>
                  <span>{option.label}</span>
                  <input
                    type="checkbox"
                    checked={effectiveCompanyIds.includes(option.companyId)}
                    onChange={(event) => {
                      setSelectedCompanyIds((current) => {
                        const currentIds = current ?? defaultCompanyIds
                        return event.target.checked
                          ? [...currentIds, option.companyId]
                          : currentIds.filter((id) => id !== option.companyId)
                      })
                      setMentions([])
                    }}
                  />
                </label>
              )) : (
                <span className="feed-company-audience__empty">
                  {audiences.isLoading ? 'Завантажуємо…' : audiences.isError ? 'Не вдалося завантажити' : 'Немає доступних компаній'}
                </span>
              )}
            </fieldset>
          )}
        </div>
        {message && <span role="status">{message}</span>}
      </footer>
      {confirmFileOnly && (
        <ConfirmationDialog
          title="Опублікувати лише файл?"
          description="Текст публікації порожній. Файл з’явиться у стрічці без пояснення."
          confirmLabel={create.isPending ? 'Публікуємо…' : 'Опублікувати файл'}
          confirmVariant="primary"
          confirmDisabled={busy}
          onRequestClose={() => { if (!busy) setConfirmFileOnly(false) }}
          onConfirm={() => {
            setConfirmFileOnly(false)
            void publish()
          }}
        />
      )}
    </form>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
