import { FileFormatIcon } from '../shared/files/FileFormatIcon'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  FeedAttachmentView,
  FeedAudienceOption,
  FeedPhotoPlacement,
  StructuredMentionInput,
} from '@lankadws/contracts'
import {
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  UsersRound,
  X,
  Paperclip,
  Send,
} from 'lucide-react'
import { FEED_COMMENT_PHOTO_LIMIT, FEED_PHOTO_MIME_TYPES } from '@lankadws/contracts'
import { InlinePhotoEditor } from '../shared/inline-photos/InlinePhotoEditor'
import { imageRatio, initialPlacement, toPhotoLayout, type InlinePhoto } from '../shared/inline-photos/inlinePhotos'
import { feedPhotoError } from '../features/feed/useFeedCommentPhotos'
import { FeedFileRow } from '../features/feed/FeedCardDesign'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import '../features/feed/feed-composer.css'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { Button, ConfirmationDialog, IconButton } from '../shared/ui'
import { FileDropOverlay, useFileDropTarget } from '../shared/files/FileDropzone'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../shared/mentions/mentionText'
import { formatFileSize } from '../shared/lib/format'

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmFileOnly, setConfirmFileOnly] = useState(false)
  const [message, setMessage] = useState('')
  const [photoError, setPhotoError] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)
  const uploadLock = useRef(false)
  const uploadRequest = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const [photoPreviews, setPhotoPreviews] = useState<InlinePhoto[]>([])
  const [preview, setPreview] = useState<FeedAttachmentView | null>(null)
  const previewUrls = useRef(new Set<string>())
  useEffect(() => {
    mounted.current = true
    const urls = previewUrls.current
    return () => { mounted.current = false; uploadRequest.current?.abort(); urls.forEach(URL.revokeObjectURL); urls.clear() }
  }, [])
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
      photoLayout: FeedPhotoPlacement[]
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
      setPhotoPreviews([])
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
    || attachments.length
    || pendingFiles.length,
  )

  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])


  const companies = (audiences.data?.items ?? []).filter((item) => item.type === 'COMPANY')
  const defaultCompanyIds = defaultCompanyId && companies.some((item) => item.companyId === defaultCompanyId)
    ? [defaultCompanyId]
    : companies.map((item) => item.companyId)
  const effectiveCompanyIds = selectedCompanyIds ?? defaultCompanyIds
  const selectedCompanies = companies.filter((item) => effectiveCompanyIds.includes(item.companyId))
  const primaryCompany = selectedCompanies[0]
  const audienceSummary = selectedCompanies.length === companies.length && companies.length > 0
    ? 'Усі'
    : selectedCompanies.length > 0
      ? selectedCompanies.map((item) => item.label).join(', ')
      : 'Ніхто'
  const mentionCandidateUrl = selectedCompanies.length > 0
    ? `/feed/mention-candidates?${new URLSearchParams({
        company: selectedCompanies[0].companyId,
        audienceType: 'COMPANY',
        companyIds: selectedCompanies.map((item) => item.companyId).join(','),
      })}`
    : null

  async function publish() {
    const prepared = trimMentionValue(body, mentions)
    if (busy || pendingFiles.length || !primaryCompany || (!prepared.body && attachments.length === 0)) return
    setMessage('')
    await create.mutateAsync({
      companyId: primaryCompany.companyId,
      body: prepared.body,
      audience: { type: 'COMPANIES', companyIds: selectedCompanies.map((item) => item.companyId) },
      requiresAcknowledgement,
      attachmentIds: attachments.map((attachment) => attachment.id),
      mentions: prepared.mentions,
      photoLayout: toPhotoLayout(photoPreviews),
    }).catch(() => {
      setMessage('Не вдалося опублікувати. Перевірте дані та спробуйте ще раз.')
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || pendingFiles.length) return
    const prepared = trimMentionValue(body, mentions)
    if (!primaryCompany || (!prepared.body && attachments.length === 0)) return
    if (!prepared.body) {
      setConfirmFileOnly(true)
      return
    }
    void publish()
  }

  const uploadSelected = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length || !primaryCompany || uploadLock.current) return
    const remaining = Math.max(0, 10 - attachments.length)
    const selected = [...files].slice(0, remaining)
    if (selected.length === 0) {
      setMessage('До однієї публікації можна додати не більше 10 файлів.')
      return
    }
    uploadLock.current = true
    const controller = new AbortController()
    uploadRequest.current = controller
    setUploading(true)
    setMessage('')
    const failures: string[] = []
    try {
      for (const file of selected) {
        const form = new FormData()
        form.append('file', file)
        try {
          const attachment = await api<FeedAttachmentView>(
            '/feed/attachments?company=' + encodeURIComponent(primaryCompany.companyId),
            { method: 'POST', body: form, signal: controller.signal },
          )
          if (!mounted.current) return
          if (FEED_PHOTO_MIME_TYPES.some((mime) => mime === file.type)) {
            const src = URL.createObjectURL(file)
            previewUrls.current.add(src)
            const ratio = await imageRatio(src)
            if (!mounted.current) return
            setPhotoPreviews((current) => [...current, {
              id: attachment.id, src, name: attachment.fileName, ratio, ...initialPlacement(current.length),
            }])
          }
          setAttachments((current) => [...current, attachment])
        } catch { if (controller.signal.aborted) return; failures.push(file.name) }
      }
    } finally {
      if (mounted.current) {
        setMessage(failures.length ? 'Не вдалося додати: ' + failures.join(', ') + '. Спробуйте ще раз.' : '')
        setUploading(false)
      }
      uploadLock.current = false
      uploadRequest.current = null
    }
  }, [attachments.length, primaryCompany])

  function selectFiles(files: FileList | File[] | null) {
    if (!files?.length || busy) return
    const remaining = Math.max(0, 10 - attachments.length - pendingFiles.length)
    if (remaining === 0) {
      setMessage('До однієї публікації можна додати не більше 10 файлів.')
      return
    }
    const selected = Array.from(files).slice(0, remaining)
    setPendingFiles((current) => [...current, ...selected])
    if (!primaryCompany) {
      setAudienceOpen(true)
      setMessage('Файли вибрано. Оберіть, хто побачить публікацію, щоб завантажити їх.')
    }
  }

  useEffect(() => {
    if (!primaryCompany || busy || pendingFiles.length === 0) return
    setPendingFiles([])
    void uploadSelected(pendingFiles)
  }, [primaryCompany, busy, pendingFiles, uploadSelected])

  const attachmentCount = attachments.length + pendingFiles.length

  const { isDragging, dropTargetProps } = useFileDropTarget({
    disabled: busy || attachmentCount >= 10,
    onFiles: selectFiles,
  })

  function selectPhotos(files: File[]) {
    const errors = files.map(feedPhotoError).filter(Boolean)
    const photoCount = attachments.filter((file) => FEED_PHOTO_MIME_TYPES.some((mime) => mime === file.mimeType)).length
      + pendingFiles.filter((file) => FEED_PHOTO_MIME_TYPES.some((mime) => mime === file.type)).length
    const remaining = Math.max(0, FEED_COMMENT_PHOTO_LIMIT - photoCount)
    const valid = files.filter((file) => !feedPhotoError(file))
    selectFiles(valid.slice(0, remaining))
    setPhotoError(errors.length || valid.length > remaining ? errors[0] ?? 'Можна вставити не більше 5 фото.' : '')
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((file) => file.id !== id))
    setPhotoPreviews((current) => current.filter((photo) => {
      if (photo.id !== id) return true
      URL.revokeObjectURL(photo.src)
      previewUrls.current.delete(photo.src)
      return false
    }))
  }

  return (
    <form className="feed-composer stream-composer is-file-drop-target" onSubmit={submit} {...dropTargetProps}>
      <FileDropOverlay active={isDragging} label="Відпустіть файли, щоб прикріпити до публікації" />
      <InlinePhotoEditor photos={photoPreviews} disabled={busy} onRemove={removeAttachment}
        onUpdate={(id, placement) => setPhotoPreviews((current) => current.map((photo) => photo.id === id ? { ...photo, ...placement } : photo))}>
        <MentionTextarea formatting className="feed-composer__body" label="Текст публікації" value={body}
          mentions={mentions} candidateUrl={mentionCandidateUrl} maxLength={10000} rows={5}
          placeholder="Поділіться важливим оновленням…" disabled={busy} autoFocus
          toolbarActions={<button type="button" className="stream-composer__insert-photo" aria-label="Вставити фото" title="Вставити фото · до 5 фото · до 10 МБ" disabled={busy || attachmentCount >= 10} onClick={() => photoInput.current?.click()}><ImagePlus size={16} /></button>}
          onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); selectPhotos(files) } }}
          onChange={(nextBody, nextMentions) => { setBody(nextBody); setMentions(nextMentions) }} />
      </InlinePhotoEditor>
      <input ref={photoInput} type="file" hidden multiple accept={FEED_PHOTO_MIME_TYPES.join(',')} disabled={busy || attachmentCount >= 10} aria-label="Фото в публікацію" onChange={(event) => { selectPhotos(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {(pendingFiles.length > 0 || attachments.some((file) => !photoPreviews.some((photo) => photo.id === file.id))) && <section className="stream-composer__files" aria-label="Додані файли">
        {pendingFiles.map((file, index) => <div key={index}><FileFormatIcon mimeType={file.type} fileName={file.name} size={24} /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)} · очікує вибору аудиторії</small></span><IconButton label={'Прибрати ' + file.name} disabled={busy} onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))}><X size={15} /></IconButton></div>)}
        {attachments.filter((file) => !photoPreviews.some((photo) => photo.id === file.id)).map((file) => <div key={file.id}><FeedFileRow file={file} onPreview={() => setPreview(file)} downloadHref={'/api/v1/files/' + encodeURIComponent(file.id) + '/download'} /><IconButton label={'Прибрати ' + file.fileName} disabled={busy} onClick={() => removeAttachment(file.id)}><X size={15} /></IconButton></div>)}
      </section>}
      <section className="stream-composer__audience">
        <button type="button" disabled={busy} aria-expanded={audienceOpen} onClick={() => setAudienceOpen((current) => !current)}><UsersRound size={16} /><span>Бачать: <strong>{audiences.isLoading ? 'завантаження…' : audienceSummary}</strong></span><ChevronDown size={15} /></button>
        {audienceOpen && <fieldset disabled={busy || audiences.isLoading}><legend>Хто побачить публікацію</legend>
          {companies.map((option) => <label key={option.companyId}><input type="checkbox" checked={effectiveCompanyIds.includes(option.companyId)} onChange={(event) => {
            setSelectedCompanyIds((current) => { const ids = current ?? defaultCompanyIds; return event.target.checked ? [...ids, option.companyId] : ids.filter((id) => id !== option.companyId) })
            setMentions([])
          }} />{option.label}</label>)}
          {!companies.length && <span>{audiences.isLoading ? 'Завантажуємо…' : audiences.isError ? 'Не вдалося завантажити' : 'Немає доступних компаній'}</span>}
        </fieldset>}
        {audiences.isError && <Button type="button" variant="secondary" onClick={() => void audiences.refetch()}>Повторити завантаження аудиторії</Button>}
      </section>
      {attachmentCount >= 10 && <p className="stream-section-label">До публікації додано максимальні 10 файлів.</p>}
      {(photoError || message) && <p className="stream-photo-error" role="alert">{photoError || message}</p>}
      <footer className="stream-composer__footer">
        <div className="stream-composer__options">
          <label className="button button--secondary stream-composer__attach">
            {uploading ? <LoaderCircle size={16} className="stream-spin" /> : <Paperclip size={16} />}
            {uploading ? 'Додаємо файли…' : 'Додати файл'}
            <input aria-label="Додати файл" type="file" multiple disabled={busy || attachmentCount >= 10} onChange={(event) => { selectFiles(event.target.files); event.target.value = '' }} />
          </label>
          {attachmentCount > 0 && <span className="stream-section-label">{attachmentCount} із 10 {pendingFiles.length ? 'вибрано' : 'прикріплено'}</span>}
          <label className="stream-composer__ack"><input type="checkbox" checked={requiresAcknowledgement} disabled={busy} onChange={(event) => setRequiresAcknowledgement(event.target.checked)} /><ShieldCheck size={17} /><span>Потрібне ознайомлення</span></label>
        </div>
        <Button disabled={!primaryCompany || busy || pendingFiles.length > 0 || (!body.trim() && attachments.length === 0)}>{create.isPending ? <LoaderCircle size={16} className="stream-spin" /> : <Send size={16} />}{create.isPending ? 'Публікуємо…' : 'Опублікувати'}</Button>
      </footer>
      {preview?.scanStatus === 'CLEAN' && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
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

