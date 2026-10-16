import { personName } from '../shared/lib/personName'
import './knowledge-reading.css'
import { FormattedText } from '../shared/text/FormattedText'
import { FormattedTextarea } from '../shared/text/FormattedTextarea'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookOpenCheck, Building2, Check, Download, Eye, File as FileIcon, MessageCircle, Network, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api, apiUrl, jsonBody, randomId } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
import { FileDropzone } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import {
  Avatar,
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageDataLoader,
  PageHeader,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'

interface ArticleList { id: string; slug: string; title: string; changeSummary: string; reviewAt: string | null; version: number; createdAt: string; requiresAcknowledgement: boolean; hasAcknowledged: boolean; updatedAt: string; imageFileId?: string | null }
interface KnowledgeAttachment { id: string; safeFilename: string; bytes: number; mimeType: string | null; scanStatus: string }
interface ArticleDetail { id: string; slug: string; version: number; createdAt: string; requiresAcknowledgement: boolean; reviewAt?: string | null; currentVersion: { title: string; body: string; changeSummary: string; publishedAt: string } | null; acknowledgement: { confirmedAt?: string | null } | null; attachments: KnowledgeAttachment[]; companyIds: string[] }
interface KnowledgeCompanyOption { id: string; name: string; isActive: boolean }
interface Employee {
  id: string
  displayName: string
  jobTitle: string
  positionTitle?: string
  timezone: string
  avatarAsset: string | null
  presence: string
  contactEmail?: string | null
  orgUnit?: { id: string; name: string; parent: { id: string; name: string } | null } | null
  manager?: { id: string; displayName: string } | null
  approver?: { id?: string; displayName: string } | null
  upcomingPresence?: Array<{ state: string; startAt: string; endAt: string }>
}
interface EmployeeDirectory {
  items: Employee[]
  counts: { all: number; available: number; away: number }
  filters: {
    orgUnits: Array<{ id: string; name: string }>
    managers: Array<{ id: string; displayName: string }>
  }
}
export default function ContentPages() {
  const path = useLocation().pathname
  if (path.startsWith('/knowledge')) return <KnowledgePage />
  if (path.startsWith('/employees')) return <EmployeesPage />
  return null
}


function KnowledgePage() {
  const { articleSlug } = useParams()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<ArticleList | null>(null)
  const client = useQueryClient()
  const canManage = user?.accountType === 'ADMIN'
  const managing = canManage && params.get('manage') === '1'
  const editor = managing ? params.get('edit') : null
  const query = useQuery({ queryKey: ['knowledge', 'articles', search], queryFn: () => api<{ items: ArticleList[] }>(`/knowledge/articles?search=${encodeURIComponent(search)}`), enabled: !articleSlug, staleTime: 0, refetchOnMount: 'always' })
  const remove = useMutation({
    mutationFn: (article: ArticleList) => api(`/knowledge/articles/${article.slug}`, { method: 'DELETE', body: jsonBody({ expectedVersion: article.version }) }),
    onSuccess: async () => {
      setDeleting(null)
      await Promise.all([client.invalidateQueries({ queryKey: ['knowledge'] }), client.invalidateQueries({ queryKey: ['dashboard'] })])
    },
  })
  const openEditor = (slug: string) => setParams((previous) => { const next = new URLSearchParams(previous); next.set('edit', slug); return next })
  const closeEditor = () => setParams((previous) => { const next = new URLSearchParams(previous); next.delete('edit'); return next })

  if (articleSlug) return <>
    <ArticlePage slug={articleSlug} backSearch={params.toString()} canManage={canManage} onEdit={() => setParams((previous) => { const next = new URLSearchParams(previous); next.set('manage', '1'); next.set('edit', articleSlug); return next })} />
    {editor && <KnowledgeEditor key={editor} slug={editor === 'new' ? undefined : editor} onClose={closeEditor} />}
  </>

  if (query.isLoading) return <div className="knowledge-page-loading"><PageDataLoader /></div>

  return <div>
    <PageHeader title="База знань" description="Інструкції, політики та матеріали для щоденної роботи" action={canManage && <Button className="knowledge-manage-button" variant="secondary" aria-pressed={managing} onClick={() => setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (managing) { next.delete('manage'); next.delete('edit') } else next.set('manage', '1')
      return next
    })}>{managing ? <Check size={17} /> : <Pencil size={17} />}{managing ? 'Завершити керування' : 'Керувати матеріалами'}</Button>} />
    <div className="knowledge-layout">
      <Card className="knowledge-feature"><BookOpenCheck size={30} /><span className="eyebrow">Знання команди</span><h2>Знайдіть відповідь без зайвих запитів</h2><label className="search-field"><Search size={18} /><input aria-label="Пошук матеріалів" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Введіть тему або ключове слово" /></label></Card>
      <section className="article-grid" aria-label="Матеріали бази знань">
        {query.isError ? <ErrorState /> : <>
          {query.data?.items.map((item) => <div className={`knowledge-article-card ${item.requiresAcknowledgement && !item.hasAcknowledged ? 'is-required' : ''}`} key={item.id}>
            <Link to={{ pathname: `/knowledge/${item.slug}`, search: params.toString() }}><KnowledgeImage fileId={item.imageFileId} className="knowledge-article-image" /><div className="knowledge-article-content"><h3>{item.title}</h3><span className={`knowledge-reading-status ${item.hasAcknowledged ? 'is-confirmed' : 'is-pending'}`}>{item.hasAcknowledged ? <Check size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}{item.hasAcknowledged ? 'Ознайомлено' : 'Не ознайомлено'}</span><small className="knowledge-article-created">Створено {formatDate(item.createdAt)}</small></div></Link>
            {item.requiresAcknowledgement && !item.hasAcknowledged && <span className="knowledge-required-marker" role="img" aria-label="Обов’язкове ознайомлення" title="Обов’язкове ознайомлення"><AlertTriangle size={18} aria-hidden="true" /></span>}
            {managing && <div className="knowledge-article-actions"><Button variant="secondary" aria-label={`Редагувати ${item.title}`} onClick={() => openEditor(item.slug)}><Pencil size={16} />Редагувати</Button><Button variant="danger" aria-label={`Видалити ${item.title}`} onClick={() => setDeleting(item)}><Trash2 size={16} />Видалити</Button></div>}
          </div>)}
          {!query.data?.items.length && <p className="knowledge-empty">{search ? 'За вашим запитом матеріалів не знайдено.' : 'Матеріалів поки немає.'}</p>}
          {managing && <button type="button" className="knowledge-add-card" onClick={() => openEditor('new')}><span><Plus size={32} /></span><strong>Додати матеріал</strong><small>Створіть нову інструкцію для команди</small></button>}
        </>}
      </section>
    </div>
    {deleting && <ConfirmationDialog title="Видалити матеріал?" description={`«${deleting.title}» буде прибрано з бази знань. Його можна буде відновити лише через технічне втручання.`} onRequestClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} confirmLabel={remove.isPending ? 'Видаляємо…' : 'Видалити'} confirmDisabled={remove.isPending} />}
    {editor && <KnowledgeEditor key={editor} slug={editor === 'new' ? undefined : editor} onClose={closeEditor} />}
  </div>
}

function KnowledgeEditor({ slug, onClose }: { slug?: string; onClose: () => void }) {
  const client = useQueryClient()
  const [dirty, setDirty] = useState(false)
  const [newSlug] = useState(() => `article-${randomId()}`)
  const [draft, setDraft] = useState<ArticleDetail | null>(null)
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([])
  const originalImage = draft?.attachments.find(isKnowledgeImage)
  const existingImage = originalImage && !removedAttachmentIds.includes(originalImage.id) ? originalImage : null
  const existingFiles = (draft?.attachments ?? []).filter((file) => file.id !== originalImage?.id && !removedAttachmentIds.includes(file.id))
  function removeAttachment(fileId: string) {
    setRemovedAttachmentIds((current) => [...new Set([...current, fileId])])
    setDirty(true)
  }
  function selectImage(files: File[]) {
    if (!files[0]) return
    if (originalImage) removeAttachment(originalImage.id)
    setImageFile(files[0])
    setAttachmentFiles((current) => current.filter((file) => file.name !== files[0].name || file.size !== files[0].size))
    setDirty(true)
  }
  const closeGuard = useModalCloseGuard({ dirty, onRequestClose: onClose })
  const article = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`), enabled: Boolean(slug) })
  useEffect(() => {
    if (article.data?.currentVersion) setDraft((current) => current ?? article.data)
  }, [article.data])
  const companies = useQuery({ queryKey: ['knowledge-company-options'], queryFn: () => api<{ items: KnowledgeCompanyOption[] }>('/admin/companies') })
  const activeCompanies = (companies.data?.items ?? []).filter((company) => company.isActive)
  // Null means "not touched yet": a new article reaches every active company and
  // an existing one keeps the audience it was published with.
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[] | null>(null)
  const audienceCompanyIds = (selectedCompanyIds
    ?? (slug ? draft?.companyIds ?? [] : activeCompanies.map((company) => company.id)))
    .filter((companyId) => activeCompanies.some((company) => company.id === companyId))
  function toggleCompany(companyId: string, checked: boolean) {
    setSelectedCompanyIds(checked
      ? [...audienceCompanyIds, companyId]
      : audienceCompanyIds.filter((item) => item !== companyId))
  }
  async function uploadAttachments() {
    if (attachmentFiles.length === 0 && !imageFile) return []
    const companyId = audienceCompanyIds[0] ?? activeCompanies[0]?.id
    if (!companyId) throw new Error('Немає активної компанії для завантаження файлу.')
    const attachmentIds: string[] = []
    for (const file of [...(imageFile ? [imageFile] : []), ...attachmentFiles]) {
      const formData = new FormData()
      formData.set('file', file)
      const uploaded = await api<{ id: string; scanStatus: string }>(`/files?company=${encodeURIComponent(companyId)}`, { method: 'POST', body: formData })
      let scanStatus = uploaded.scanStatus
      for (let attempt = 0; scanStatus !== 'CLEAN' && attempt < 6; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
        scanStatus = (await api<{ scanStatus: string }>(`/files/${uploaded.id}/status`)).scanStatus
      }
      if (scanStatus !== 'CLEAN') throw new Error(`Файл «${file.name}» ще проходить перевірку. Зачекайте кілька секунд і збережіть матеріал повторно.`)
      attachmentIds.push(uploaded.id)
    }
    return attachmentIds
  }
  const save = useMutation({
    mutationFn: async (data: FormData) => api(slug ? `/knowledge/articles/${slug}` : '/knowledge/articles', {
      method: slug ? 'PATCH' : 'POST',
      body: jsonBody({ title: data.get('title'), body: data.get('body'), changeSummary: data.get('changeSummary') ?? '', attachmentIds: await uploadAttachments(), companyIds: audienceCompanyIds, requiresAcknowledgement: data.get('requiresAcknowledgement') === 'required', ...(slug ? { expectedVersion: Number(data.get('expectedVersion')), removedAttachmentIds } : { slug: newSlug }) }),
    }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['knowledge'] }), client.invalidateQueries({ queryKey: ['article'] }), client.invalidateQueries({ queryKey: ['dashboard'] })])
      closeGuard.closeForSuccess(onClose)
    },
  })
  const ready = slug ? Boolean(draft?.currentVersion) : activeCompanies.length > 0
  return <>
    <Modal
      title={slug ? 'Редагувати матеріал' : 'Додати матеріал'}
      description={slug ? 'Оновіть текст і аудиторію матеріалу.' : 'Опублікуйте інструкцію для потрібних компаній.'}
      size="lg"
      closeDisabled={save.isPending}
      onBeforeClose={closeGuard.shouldClose}
      onRequestClose={save.isPending ? () => {} : closeGuard.requestClose}
    >
      {(slug ? article.isLoading || companies.isLoading : companies.isLoading) ? <PageDataLoader /> : !ready ? <ErrorState /> : <form className="entity-form" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(new FormData(event.currentTarget)) }}>
        {slug && <input type="hidden" name="expectedVersion" value={draft?.version ?? ''} />}
        <label className="span-2">Назва<input name="title" required defaultValue={draft?.currentVersion?.title ?? ''} autoFocus disabled={save.isPending} /></label>
        <div className="span-2"><FormattedTextarea label="Текст матеріалу" name="body" rows={12} required defaultValue={draft?.currentVersion?.body ?? ''} disabled={save.isPending} /></div>
        <label className="span-2">Ознайомлення<select name="requiresAcknowledgement" defaultValue={draft?.requiresAcknowledgement ? 'required' : 'optional'} disabled={save.isPending}>
          <option value="optional">Необов’язкове ознайомлення</option>
          <option value="required">Обов’язкове ознайомлення</option>
        </select></label>
        <fieldset className="knowledge-audience span-2" disabled={save.isPending}>
          <legend>Хто побачить статтю</legend>
          <div className="knowledge-audience__companies">
            {activeCompanies.map((company) => <label className="check-label" key={company.id}>
              <input type="checkbox" checked={audienceCompanyIds.includes(company.id)} onChange={(event) => toggleCompany(company.id, event.target.checked)} />
              {company.name}
            </label>)}
          </div>
          {audienceCompanyIds.length === 0 && <p className="knowledge-audience__hint" role="alert">Оберіть щонайменше одну компанію.</p>}
        </fieldset>
        <div className="span-2 knowledge-image-upload">
          <strong>Картинка запису</strong>
          <p>Одна картинка для прев’ю запису. Вибір іншої картинки замінює попередню.</p>
          {imageFile || existingImage ? <div className="knowledge-image-slot">
            {imageFile ? <KnowledgeSelectedImage file={imageFile} /> : <KnowledgeImage fileId={existingImage?.id} className="knowledge-image-preview" />}
            <div className="knowledge-image-slot__details"><strong>{imageFile?.name ?? existingImage?.safeFilename}</strong><small>Картинку вибрано · 1 з 1</small>
              <div className="knowledge-image-slot__actions"><FileDropzone className="knowledge-image-replace" label="Замінити картинку" accept="image/png,image/jpeg,image/gif,image/webp" resetAfterSelect disabled={save.isPending} title="Замінити картинку" buttonLabel="Замінити" onFiles={selectImage} /><Button type="button" variant="ghost" aria-label="Прибрати картинку" disabled={save.isPending} onClick={() => { setImageFile(null); if (existingImage) removeAttachment(existingImage.id); setDirty(true) }}><X size={16} />Прибрати</Button></div>
            </div>
          </div> : <FileDropzone label="Додати картинку" accept="image/png,image/jpeg,image/gif,image/webp" resetAfterSelect disabled={save.isPending} title="Додайте одну картинку" hint="PNG, JPG, GIF або WebP · 1 файл" onFiles={selectImage} />}
        </div>
        <div className="span-2 knowledge-attachments-upload">
          <span className="knowledge-attachments-upload__label">Файли</span>
          <FileDropzone
            label="Додати файли"
            multiple
            resetAfterSelect
            disabled={save.isPending}
            title="Перетягніть файли сюди"
            hint="Файли буде прикріплено після перевірки безпеки."
            onFiles={(files) => { setDirty(true); setAttachmentFiles((current) => [
              ...current,
              ...files.filter((file) => !(imageFile?.name === file.name && imageFile.size === file.size) && !current.some((picked) => picked.name === file.name && picked.size === file.size)),
            ]) }}
          >
            {attachmentFiles.length > 0 && (
              <ul className="file-dropzone-files" aria-label="Вибрані файли">
                {attachmentFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`}>
                    <FileIcon size={15} aria-hidden="true" />
                    <span>{file.name}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Прибрати ${file.name}`}
                      disabled={save.isPending}
                      onClick={() => { setDirty(true); setAttachmentFiles((current) => current.filter((picked) => (
                        picked.name !== file.name || picked.size !== file.size
                      ))) }}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FileDropzone>
        </div>
        {existingFiles.length ? <section className="knowledge-existing-files" aria-label="Прикріплені файли"><strong>Прикріплені файли</strong><ul className="knowledge-file-list">{existingFiles.map((file) => <KnowledgeExistingFile key={file.id} file={file} disabled={save.isPending} onRemove={() => removeAttachment(file.id)} />)}</ul></section> : null}
        {save.isError && <p className="form-error span-2" role="alert">{save.error instanceof Error ? save.error.message : 'Не вдалося зберегти матеріал. Спробуйте ще раз.'}</p>}
        <Button type="submit" className="span-2 knowledge-save-button" disabled={save.isPending || audienceCompanyIds.length === 0}>{save.isPending ? 'Зберігаємо…' : slug ? 'Зберегти зміни' : 'Опублікувати матеріал'}</Button>
      </form>}
    </Modal>
    <UnsavedChangesDialog
      guard={closeGuard}
      title={slug ? 'Закрити редагування матеріалу?' : 'Закрити створення матеріалу?'}
      description={slug
        ? 'Незбережені зміни матеріалу буде втрачено.'
        : 'Новий матеріал не буде опубліковано.'}
    />
  </>
}

function ArticlePage({ slug, backSearch, canManage, onEdit }: { slug: string; backSearch: string; canManage: boolean; onEdit: () => void }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`) })
  const ack = useMutation({
    mutationFn: () => api<{ confirmed: boolean; confirmedAt: string }>(`/knowledge/articles/${slug}/acknowledge`, { method: 'POST', body: jsonBody({ expectedVersion: query.data?.version }) }),
    onSuccess: async (result) => {
      const confirmedArticle = query.data
      if (confirmedArticle) {
        client.setQueryData<ArticleDetail>(['article', slug], (current) => current?.version === confirmedArticle.version ? { ...current, acknowledgement: { confirmedAt: result.confirmedAt } } : current)
        client.setQueriesData<{ items: ArticleList[] }>({ queryKey: ['knowledge', 'articles'] }, (current) => current ? { ...current, items: current.items.map((item) => item.id === confirmedArticle.id && item.version === confirmedArticle.version ? { ...item, hasAcknowledged: true } : item) } : current)
      }
      await Promise.all([client.invalidateQueries({ queryKey: ['article', slug] }), client.invalidateQueries({ queryKey: ['knowledge'], refetchType: 'all' }), client.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' })])
    },
  })
  const params = new URLSearchParams(backSearch)
  params.delete('edit')
  const article = query.data
  const version = article?.currentVersion
  const coverImage = article?.attachments.find(isKnowledgeImage)
  const attachedFiles = (article?.attachments ?? []).filter((file) => file.id !== coverImage?.id)
  return <div className="knowledge-reading-page">
    <nav className="knowledge-reading-nav" aria-label="Навігація статті">
      <Link to={{ pathname: '/knowledge', search: params.toString() }}>← База знань</Link>
      {canManage && version && <Button variant="secondary" onClick={onEdit}><Pencil size={16} />Редагувати матеріал</Button>}
    </nav>
    {query.isLoading ? <PageDataLoader /> : query.isError || !version || !article ? <ErrorState /> : <article className="knowledge-reading-card">
      <header className="knowledge-reading-header">
        <span className="eyebrow"><BookOpenCheck size={18} />Матеріал бази знань</span>
        <h1>{version.title}</h1>
        <div className="knowledge-reading-meta"><span>Створено {formatDateTime(article.createdAt)}</span>{article.requiresAcknowledgement && <span className="knowledge-required-label"><AlertTriangle size={16} />Обов’язкове ознайомлення</span>}</div>
      </header>
      {coverImage && <KnowledgeImage fileId={coverImage.id} className="knowledge-reading-image" />}
      <div className="knowledge-reading-body"><FormattedText body={version.body} /></div>
      {attachedFiles.length > 0 && <section className="knowledge-reading-files"><h2>Прикріплені файли</h2><div className="knowledge-attachment-list">{attachedFiles.map((file) => <KnowledgeAttachmentPreview key={file.id} attachment={file} />)}</div></section>}
      <footer className="knowledge-reading-footer">
        {article.acknowledgement?.confirmedAt ? <p className="success-note"><Check size={17} />Ви ознайомилися {formatDateTime(article.acknowledgement.confirmedAt)}</p> : <Button disabled={ack.isPending} onClick={() => ack.mutate()}><Check size={17} />{ack.isPending ? 'Підтверджуємо…' : 'Ознайомився'}</Button>}
        {ack.isError && <p className="form-error" role="alert">Не вдалося підтвердити ознайомлення. Спробуйте ще раз.</p>}
      </footer>
    </article>}
  </div>
}

function isKnowledgeImage(file: KnowledgeAttachment) {
  return file.scanStatus === 'CLEAN' && /^image\/(png|jpeg|gif|webp)$/.test(file.mimeType ?? '')
}

function KnowledgeImage({ fileId, className }: { fileId?: string | null; className: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return fileId && failed !== fileId
    ? <img className={className} src={apiUrl(`/files/${encodeURIComponent(fileId)}/download?inline=true`)} alt="" loading="lazy" onError={() => setFailed(fileId)} />
    : <span className="article-icon"><BookOpenCheck size={20} /></span>
}

function KnowledgeSelectedImage({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url ? <img className="knowledge-image-preview" src={url} alt="Вибрана картинка запису" /> : null
}

function KnowledgeExistingFile({ file, disabled, onRemove }: { file: KnowledgeAttachment; disabled: boolean; onRemove: () => void }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
    <li>
      <FileIcon size={16} />
      {file.scanStatus === 'CLEAN' ? (
        <button type="button" className="knowledge-file-list__preview" onClick={() => setPreviewOpen(true)}>
          {file.safeFilename}
        </button>
      ) : <span className="knowledge-file-list__name">{file.safeFilename}</span>}
      <small>{file.scanStatus === 'CLEAN' ? 'Готовий' : 'Перевіряється'}</small>
      <button type="button" className="icon-button" aria-label={`Прибрати ${file.safeFilename}`} disabled={disabled} onClick={onRemove}><X size={16} /></button>
      {previewOpen && (
        <FilePreviewModal
          file={{ id: file.id, fileName: file.safeFilename, mimeType: file.mimeType, bytes: file.bytes }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </li>
  )
}

function KnowledgeAttachmentPreview({ attachment }: { attachment: KnowledgeAttachment }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return <section className="document-preview knowledge-attachment-preview" aria-label={`Прикріплений файл ${attachment.safeFilename}`}><div className="knowledge-attachment-preview__footer"><span title={attachment.safeFilename}>{attachment.safeFilename}</span><div><Button variant="ghost" aria-label={`Переглянути ${attachment.safeFilename}`} disabled={attachment.scanStatus !== 'CLEAN'} onClick={() => setPreviewOpen(true)}><Eye size={16} />Переглянути</Button><a className="icon-button" aria-label={`Завантажити ${attachment.safeFilename}`} href={`/api/v1/files/${attachment.id}/download`}><Download size={17} /></a></div></div>{previewOpen && <FilePreviewModal file={{ id: attachment.id, fileName: attachment.safeFilename, mimeType: attachment.mimeType, bytes: attachment.bytes }} onClose={() => setPreviewOpen(false)} />}</section>
}

function EmployeesPage() {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const search = params.get('q') ?? ''
  const companyId = user?.company?.id ?? ''
  const orgUnitId = params.get('orgUnit') ?? ''
  const managerId = params.get('manager') ?? ''
  const presence = params.get('presence') ?? ''
  const requestQuery = new URLSearchParams()
  if (search) requestQuery.set('search', search)
  if (companyId) requestQuery.set('company', companyId)
  if (orgUnitId) requestQuery.set('orgUnit', orgUnitId)
  if (managerId) requestQuery.set('manager', managerId)
  if (presence) requestQuery.set('presence', presence)
  const query = useQuery({
    queryKey: ['employees', search, companyId, orgUnitId, managerId, presence],
    queryFn: () => api<EmployeeDirectory>(`/employees?${requestQuery.toString()}`),
  })
  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    if (name === 'company') {
      next.delete('orgUnit')
      next.delete('manager')
    }
    setParams(next, { replace: true })
  }
  const clearFilters = () => {
    const next = new URLSearchParams()
    if (companyId) next.set('company', companyId)
    setParams(next, { replace: true })
  }
  const hasFilters = Boolean(search || orgUnitId || managerId || presence)
  const orgUrl = '/employees/org'

  return (
    <div>
      <PageHeader
        title="Працівники"
        description="Знайдіть потрібну людину, команду або керівника без зайвих переходів"
        action={(
          <Link className="button button--secondary" to={orgUrl}>
            <Network size={17} />Структура організації
          </Link>
        )}
      />
      <Card className="directory-card">
        <div className="directory-toolbar">
          <label className="search-field">
            <span className="sr-only">Знайти працівника</span>
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Ім’я, посада або нікнейм"
              type="search"
            />
          </label>
          {(
            <>
              <label className="directory-filter">
                <span>Підрозділ</span>
                <select value={orgUnitId} onChange={(event) => updateFilter('orgUnit', event.target.value)}>
                  <option value="">Усі підрозділи</option>
                  {query.data?.filters.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </label>
              <div className="directory-filter">
                <UserSearchCombobox label="Керівник" value={managerId} companyId={companyId || undefined} managersOnly
                  defaultUser={query.data?.filters.managers.find((manager) => manager.id === managerId)}
                  placeholder="Усі · введіть ім’я" onChange={(id) => updateFilter('manager', id)} />
              </div>
            </>
          )}
          <label className="directory-filter">
            <span>Доступність</span>
            <select value={presence} onChange={(event) => updateFilter('presence', event.target.value)}>
              <option value="">Усі</option>
              <option value="AVAILABLE">Доступні</option>
              <option value="AWAY">Відсутні</option>
            </select>
          </label>
        </div>
        <div className="directory-summary" aria-live="polite">
          <span><strong>{query.data?.items.length ?? 0}</strong> знайдено</span>
          {query.data && <span>{query.data.counts.available} доступні · {query.data.counts.away} відсутні</span>}
          {hasFilters && <button type="button" onClick={clearFilters}><X size={14} />Очистити</button>}
        </div>
        {query.isLoading ? <PageDataLoader /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="employee-grid">
            {query.data.items.map((item) => (
                <article className="employee-card" key={item.id}>
                  <UserProfileLink
                    className="employee-card__profile"
                    userId={item.id}
                  >
                    <Avatar size="lg" name={personName(item.displayName)} src={item.avatarAsset} />
                    <span>
                      <strong>{personName(item.displayName)}</strong>
                      <small>{item.positionTitle || item.jobTitle}</small>
                      {item.orgUnit && <small className="employee-org"><Building2 size={12} />{item.orgUnit.parent ? `${item.orgUnit.parent.name} → ${item.orgUnit.name}` : item.orgUnit.name}</small>}
                      <em>
                        <i className={`presence presence--${item.presence.toLowerCase()}`} />
                        {item.presence === 'AVAILABLE' ? 'Доступний' : 'Відсутній'}
                      </em>
                    </span>
                  </UserProfileLink>
                  {item.id !== user?.id && (
                    <Link
                      className="employee-card__chat"
                      aria-label={`Написати ${personName(item.displayName)}`}
                      title={`Написати ${personName(item.displayName)}`}
                      to={`/messages?new=1&to=${encodeURIComponent(item.id)}`}
                    >
                      <MessageCircle size={17} />
                    </Link>
                  )}
                </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Нікого не знайдено"
            description="Змініть пошук або очистьте один із фільтрів."
            illustration="search"
            action={hasFilters && <Button variant="secondary" onClick={clearFilters}>Очистити фільтри</Button>}
          />
        )}
      </Card>
    </div>
  )
}
