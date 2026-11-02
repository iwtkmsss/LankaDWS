import { useId, useState, type ReactNode } from 'react'
import { ArrowRight, CalendarDays, CakeSlice, Check, CheckCircle2, Clock3, Download, FileText, Inbox, ListTodo, LoaderCircle, MessageCircle, Paperclip, Search, Send, ShieldCheck, Sparkles, TriangleAlert, UsersRound, X } from 'lucide-react'
import { Avatar, Button, ConfirmationDialog, Modal } from '../../shared/ui'
import { ShowcasePublicationEditor } from './ShowcasePublicationEditor'
import { useShowcasePhotos } from './showcasePhotos'
import { FeedFileRow } from './FeedCardDesign'
import { demoFile, people } from './feedShowcaseData'

export interface SupportingStory { id: string; title: string; description: string; group: 'page' | 'composer' | 'files'; content: ReactNode }

function FeedSkeleton() { return <div className="showcase-skeleton" role="status" aria-label="Завантаження стрічки"><div><i /><span><i /><i /></span></div><i /><i /><footer><i /><i /></footer><span className="sr-only">Завантаження…</span></div> }
function EmptyFeed({ filtered = false, error = false }: { filtered?: boolean; error?: boolean }) {
  const [retried, setRetried] = useState(false)
  return <div className={`showcase-empty${error ? ' is-error' : ''}`}>
    <span>{error ? <TriangleAlert size={25} /> : filtered ? <Search size={25} /> : <Inbox size={25} />}</span>
    <h3>{error ? 'Не вдалося завантажити стрічку' : filtered ? 'За цим посиланням нічого немає' : 'Оновлень ще немає'}</h3>
    <p>{error ? 'Перевірте з’єднання та спробуйте ще раз.' : filtered ? 'Поверніться до всієї стрічки, щоб побачити оновлення.' : 'Тут з’являться публікації, завдання, події та матеріали команди.'}</p>
    <Button type="button" variant="secondary" onClick={() => setRetried(true)}>{error ? 'Спробувати ще раз' : filtered ? 'Показати всю стрічку' : 'Створити публікацію'}</Button>
    {retried && <small role="status">Дію виконано в демонстраційному прикладі.</small>}
  </div>
}
function Attention({ acknowledgements, tasks }: { acknowledgements: number; tasks: number }) {
  return <section className="showcase-attention"><span className="stream-section-label">ПОТРЕБУЄ УВАГИ</span><h3>Ваші наступні кроки</h3><div><ShieldCheck size={20} /><span><strong>{acknowledgements}</strong><small>підтверджень очікують</small></span></div><div><Clock3 size={20} /><span><strong>{tasks}</strong><small>прострочених завдань</small></span></div>{!acknowledgements && !tasks && <p><CheckCircle2 size={16} />Термінових дій немає</p>}</section>
}
function OverviewExample({ attention = false, nextEvent = false }: { attention?: boolean; nextEvent?: boolean }) {
  const metrics = [
    { Icon: ListTodo, label: 'Активні завдання', value: attention ? 12 : nextEvent ? 6 : 0 },
    { Icon: TriangleAlert, label: 'Прострочені', value: attention ? 5 : 0, danger: true },
    { Icon: CalendarDays, label: attention ? 'Події сьогодні' : 'Найближча подія', value: attention ? 2 : nextEvent ? 'Планування роботи команди на наступний тиждень' : '—', textValue: nextEvent, detail: nextEvent ? '29 жовтня' : undefined },
    { Icon: MessageCircle, label: 'Непрочитані чати', value: attention ? 8 : 0 },
  ]
  return <section className={`showcase-overview focus-panel focus-panel--${attention ? 'attention' : 'clear'}`} aria-label="Робочий огляд">
    <div className="focus-panel__intro">
      <span className="eyebrow"><Sparkles size={15} aria-hidden="true" />Середа, 28 жовтня</span>
      <h3>{attention ? 'Маріє, ось що зараз потребує уваги.' : 'Маріє, термінових справ немає.'}</h3>
      <p>{attention ? '5 пунктів потребують уваги.' : 'План дня та актуальний робочий контекст зібрані нижче.'}</p>
    </div>
    <section className="dashboard-kpis" aria-label="Ключові показники">
      {metrics.map(({ Icon, label, value, danger, textValue, detail }) => <div className={`dashboard-kpi${danger ? ' dashboard-kpi--danger' : ''}`} key={label}>
        <i><Icon size={19} aria-hidden="true" /></i>
        <span className={textValue ? 'showcase-overview__event' : undefined}>
          <small title={label}>{label}</small>
          <strong className={textValue ? 'dashboard-kpi__text-value' : undefined} title={textValue ? String(value) : undefined}>{value}</strong>
          {detail && <em>{detail}</em>}
        </span>
        <ArrowRight size={15} aria-hidden="true" />
      </div>)}
    </section>
  </section>
}
function Birthdays({ today, multiple }: { today?: boolean; multiple?: boolean }) { return <section className="showcase-birthdays"><h3><CakeSlice size={20} />Дні народження</h3>{[people.maria, ...(multiple ? [people.andrii, people.olena] : [])].map((person, index) => <div key={person.id}><Avatar name={person.displayName} src={person.avatarAsset} /><span><strong>{person.displayName}</strong><small>{today && index === 0 ? 'Сьогодні' : `${28 + index} жовтня`}</small></span>{today && index === 0 && <span className="stream-type stream-type--attention">Сьогодні</span>}</div>)}</section> }

function ComposerExample({ variant }: { variant: 'empty' | 'ready' | 'audience' | 'files' | 'uploading' | 'error' | 'publishing' | 'file-only' | 'limit' | 'close' }) {
  const editorId = useId()
  const photos = useShowcasePhotos()
  const [body, setBody] = useState(['empty', 'file-only'].includes(variant) ? '' : '**Оновлення команди**\n\nУзгодили план роботи на наступний тиждень. Перегляньте матеріали та додайте свої питання.')
  const [ack, setAck] = useState(variant === 'ready')
  const [audienceOpen, setAudienceOpen] = useState(variant === 'audience')
  const [audiences, setAudiences] = useState(variant === 'audience' ? [] as string[] : ['LankaDWS Україна'])
  const [files, setFiles] = useState(['files', 'file-only', 'limit'].includes(variant) ? Array.from({ length: variant === 'limit' ? 10 : 1 }, (_, index) => demoFile(`composer-${index}`, 'CLEAN', `Матеріали команди${index ? ` ${index + 1}` : ''}.pdf`)) : [])
  const [confirmation, setConfirmation] = useState(false)
  const [fileOnlyConfirm, setFileOnlyConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const [published, setPublished] = useState(false)
  const busy = variant === 'uploading' || variant === 'publishing' || photos.busy
  function publish() { setPublished(true); setFileOnlyConfirm(false); setMessage('Приклад публікації готовий. Дані залишилися тільки в галереї.') }
  return <div className="showcase-composer"><header><h3>Створити публікацію</h3><button type="button" aria-label="Закрити форму" onClick={() => setConfirmation(true)}><X size={18} /></button></header>
    <form onSubmit={(event) => { event.preventDefault(); if (busy || !audiences.length || (!body.trim() && !files.length && !photos.photos.length)) return; if (!body.trim() && (files.length || photos.photos.length)) setFileOnlyConfirm(true); else publish() }}>
      <ShowcasePublicationEditor id={editorId} value={body} onChange={setBody} photos={photos} disabled={busy} />
      {files.length > 0 && <section className="showcase-composer__files" aria-label="Додані файли">{files.map((file) => <div key={file.id}><FeedFileRow file={file} onPreview={() => setMessage('Вкладення готове до перегляду.')} onDownload={() => setMessage('Демонстраційна дія завантаження.')} /><button type="button" aria-label={`Прибрати ${file.fileName}`} disabled={busy} onClick={() => setFiles((current) => current.filter((entry) => entry.id !== file.id))}><X size={15} /></button></div>)}</section>}
      <div className="showcase-composer__options"><Button type="button" variant="secondary" disabled={busy || files.length >= 10} onClick={() => setFiles((current) => [...current, demoFile(`composer-${current.length}`, 'CLEAN', `Матеріали команди ${current.length + 1}.pdf`)])}>{busy && variant === 'uploading' ? <LoaderCircle size={16} className="stream-spin" /> : <Paperclip size={16} />}{variant === 'uploading' ? 'Додаємо файли…' : `Додати файл${files.length ? ` · ${files.length}/10` : ''}`}</Button><label><input type="checkbox" checked={ack} disabled={busy} onChange={(event) => setAck(event.target.checked)} /><ShieldCheck size={17} /><span>Потрібне ознайомлення</span></label></div>
      <section className="showcase-composer__audience"><button type="button" disabled={busy} aria-expanded={audienceOpen} onClick={() => setAudienceOpen(!audienceOpen)}><UsersRound size={16} /><span>Бачать: <strong>{audiences.length ? audiences.join(', ') : 'оберіть аудиторію'}</strong></span></button>{audienceOpen && <fieldset disabled={busy}><legend>Хто побачить публікацію</legend>{['LankaDWS Україна', 'LankaDWS Захід', 'LankaDWS Центральний офіс'].map((name) => <label key={name}><input type="checkbox" checked={audiences.includes(name)} onChange={(event) => setAudiences((current) => event.target.checked ? [...current, name] : current.filter((entry) => entry !== name))} />{name}</label>)}</fieldset>}</section>
      {variant === 'error' && !published && <p className="stream-inline-error" role="alert"><TriangleAlert size={16} />Не вдалося опублікувати. Перевірте дані та спробуйте ще раз.</p>}
      {variant === 'limit' && <p className="showcase-dialog-note">До публікації додано максимальні 10 файлів.</p>}
      {message && <p className="showcase-composer__message" role="status"><Check size={16} />{message}</p>}
      <footer><span>Публікацію побачить обрана аудиторія</span><Button disabled={busy || !audiences.length || (!body.trim() && !files.length && !photos.photos.length)}>{variant === 'publishing' ? <LoaderCircle size={16} className="stream-spin" /> : <Send size={16} />}{variant === 'publishing' ? 'Публікуємо…' : 'Опублікувати'}</Button></footer>
    </form>
    {fileOnlyConfirm && <ConfirmationDialog title="Опублікувати лише файл?" description="Текст порожній. Файл з’явиться без пояснення." confirmLabel="Опублікувати файл" confirmVariant="primary" onRequestClose={() => setFileOnlyConfirm(false)} onConfirm={publish} />}
    {confirmation && <ConfirmationDialog title="Закрити створення публікації?" description="Текст, аудиторія та додані файли не збережуться." confirmLabel="Закрити без збереження" onRequestClose={() => setConfirmation(false)} onConfirm={() => { setConfirmation(false); setMessage('Форму закрито в демонстраційному прикладі.'); setBody(''); setFiles([]); photos.clearDraft() }} />}
  </div>
}

export const supportingStories: SupportingStory[] = [
  ...(['image', 'pdf', 'text', 'unsupported', 'too-large', 'loading', 'error'] as const).map((variant, index) => ({ id: `preview-${variant}`, group: 'files' as const, title: ['Перегляд зображення', 'Перегляд PDF', 'Перегляд тексту', 'Формат без вбудованого перегляду', 'Завеликий текст для перегляду', 'Завантаження перегляду', 'Помилка перегляду'][index], description: 'Відкрийте приклад для перевірки стану спільного діалогового вікна.', content: <PreviewStateExample variant={variant} /> })),
  { id: 'page-loading', group: 'page', title: 'Початкове завантаження', description: 'Спокійний каркас картки до отримання даних.', content: <FeedSkeleton /> },
  { id: 'page-empty', group: 'page', title: 'Стрічка порожня', description: 'Пояснення та наступна дія.', content: <EmptyFeed /> },
  { id: 'page-filter-empty', group: 'page', title: 'Немає результатів за посиланням', description: 'Повернення до всієї стрічки.', content: <EmptyFeed filtered /> },
  { id: 'page-error', group: 'page', title: 'Помилка завантаження', description: 'Так само використовується для помилки відкриття окремої публікації.', content: <EmptyFeed error /> },
  { id: 'page-pagination', group: 'page', title: 'Завантаження давніших записів', description: 'Доступна дія, очікування та кінець списку.', content: <PaginationExample /> },
  ...[{ acknowledgements: 0, tasks: 0 }, { acknowledgements: 3, tasks: 0 }, { acknowledgements: 0, tasks: 2 }, { acknowledgements: 3, tasks: 2 }].map((value, index) => ({ id: `attention-${index}`, group: 'page' as const, title: `Потребує уваги · ${['немає термінових дій', 'підтвердження', 'прострочені завдання', 'обидві групи'][index]}`, description: 'Особисті наступні кроки, окремо від хронології.', content: <Attention {...value} /> })),
  { id: 'overview-clear', group: 'page', title: 'Робочий огляд · усе актуально', description: 'Нульові показники та відсутність подій.', content: <OverviewExample /> },
  { id: 'overview-attention', group: 'page', title: 'Робочий огляд · є важливі справи', description: 'Ненульові показники та події сьогодні.', content: <OverviewExample attention /> },
  { id: 'overview-next-event', group: 'page', title: 'Робочий огляд · найближча подія', description: 'Довга назва замість числового показника.', content: <OverviewExample nextEvent /> },
  { id: 'birthdays-today', group: 'page', title: 'День народження сьогодні', description: 'Одна людина, помітна дата без віку.', content: <Birthdays today /> },
  { id: 'birthdays-soon', group: 'page', title: 'Найближчі дні народження', description: 'Кілька людей. Коли список порожній, блок не показується.', content: <Birthdays multiple /> },
  ...(['empty', 'ready', 'audience', 'files', 'uploading', 'error', 'publishing', 'file-only', 'limit', 'close'] as const).map((variant, index) => ({ id: `composer-${variant}`, group: 'composer' as const, title: ['Порожня форма', 'Текст і вимога ознайомлення', 'Вибір аудиторії', 'Додані вкладення', 'Завантаження файлів', 'Помилка публікації', 'Публікація виконується', 'Лише файл без тексту', 'Ліміт вкладень', 'Незбережені зміни'][index], description: variant === 'close' ? 'Натисніть хрестик для перевірки підтвердження виходу.' : 'Демонстраційна форма зі спільним редактором; усі дії локальні.', content: <ComposerExample variant={variant} /> })),
]

function PaginationExample() {
  const [loaded, setLoaded] = useState(false)
  return <div className="showcase-pagination"><Button type="button" variant="secondary" onClick={() => setLoaded(true)}>Показати давніші публікації</Button><Button type="button" variant="secondary" disabled><LoaderCircle size={15} className="stream-spin" />Завантаження…</Button><p role="status">{loaded ? 'Давніші записи завантажено. Ви переглянули всі оновлення.' : 'Ви переглянули всі оновлення'}</p></div>
}

function PreviewStateExample({ variant }: { variant: 'image' | 'pdf' | 'text' | 'unsupported' | 'too-large' | 'loading' | 'error' }) {
  const [open, setOpen] = useState(false)
  const [retried, setRetried] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  return <div className="showcase-preview-launch"><FileText size={25} /><span><strong>Матеріали команди</strong><small>Перегляд у модальному вікні</small></span><Button type="button" variant="secondary" onClick={() => setOpen(true)}>Відкрити приклад</Button>{downloaded && <p role="status">Дію завантаження перевірено в галереї.</p>}
    {open && <Modal title="Матеріали команди" size={['unsupported', 'too-large'].includes(variant) ? 'md' : 'lg'} onRequestClose={() => setOpen(false)}>
      <div className="showcase-file-preview"><span className="showcase-dialog-note">Демонстраційний вміст для перевірки вигляду</span>
        {variant === 'loading' ? <div className="showcase-preview-status" role="status"><LoaderCircle size={28} className="stream-spin" /><p>Завантажуємо вміст файлу…</p></div>
          : variant === 'error' && !retried ? <div className="showcase-preview-status is-error" role="alert"><TriangleAlert size={28} /><h3>Не вдалося відкрити файл</h3><p>Перевірте з’єднання та спробуйте ще раз.</p><Button type="button" variant="secondary" onClick={() => setRetried(true)}>Спробувати ще раз</Button></div>
          : variant === 'unsupported' || variant === 'too-large' ? <div className="showcase-preview-status"><FileText size={30} /><h3>{variant === 'too-large' ? 'Текст завеликий для перегляду' : 'Попередній перегляд недоступний'}</h3><p>Завантажте файл, щоб відкрити його на своєму пристрої.</p></div>
          : variant === 'image' ? <img src="/assets/auth/editorial-workspace.png" alt="Робочий простір команди — приклад перегляду зображення" />
          : variant === 'text' ? <pre className="showcase-text-preview">{'Підсумок зустрічі\n\n1. Узгодити матеріали.\n2. Зафіксувати рішення.\n3. Повідомити команду про наступні кроки.'}</pre>
          : <div className="showcase-document"><FileText size={28} /><h2>План роботи команди</h2><p>28 жовтня 2026</p><hr /><h3>Наступні кроки</h3><p>Узгодити матеріали, зафіксувати рішення та повідомити команду.</p></div>}
        <Button type="button" variant="secondary" onClick={() => { setDownloaded(true); setOpen(false) }}><Download size={16} />Завантажити</Button>
      </div>
    </Modal>}
  </div>
}
