import { useEffect, useId, useRef, useState } from 'react'
import type { FeedAttachmentView } from '@lankadws/contracts'
import { ArrowRight, Download, FileText } from 'lucide-react'
import { Avatar, Button, Modal } from '../../shared/ui'
import { FeedCardDesign, FeedMetadata, type CardAction, type FeedCardViewState, type FeedMetadataPerson } from './FeedCardDesign'
import { people, type FeedStory } from './feedShowcaseData'
import { useShowcasePhotos } from './showcasePhotos'
import type { FeedCardModel } from './FeedCardDesign'

export function FeedStoryExample({ story }: { story: FeedStory }) {
  const editorId = useId()
  const [item, setItem] = useState<FeedCardModel>(story.item)
  const commentPhotos = useShowcasePhotos()
  const [savedBody, setSavedBody] = useState(story.item.body)
  const [state, setState] = useState<FeedCardViewState>({ mode: 'read', menuOpen: false, commentsOpen: false, replyTo: null, comment: '', sending: false, liking: false, notice: '', ...story.view })
  const [dialog, setDialog] = useState<'profile' | 'source' | FeedAttachmentView | null>(null)
  const [profile, setProfile] = useState<FeedMetadataPerson | null>(null)
  function openProfile(person: FeedMetadataPerson) { setProfile(person); setDialog('profile') }
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const patch = (value: Partial<FeedCardViewState>) => setState((current) => ({ ...current, ...value }))
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  function later(callback: () => void) { timers.current.push(setTimeout(callback, 650)) }

  function handleAction(action: CardAction) {
    if (action === 'menu') patch({ menuOpen: !state.menuOpen })
    if (action === 'comments') patch({ commentsOpen: !state.commentsOpen })
    if (action === 'profile') openProfile(item.author ?? { displayName: 'Автор запису', avatarAsset: null })
    if (action === 'open') setDialog('source')
    if (action === 'edit') patch({ mode: 'edit', menuOpen: false })
    if (action === 'cancel-edit') { setItem((current) => ({ ...current, body: savedBody })); patch({ mode: 'read' }) }
    if (action === 'save') {
      patch({ mode: 'saving' })
      later(() => { setSavedBody(item.body); setItem((current) => ({ ...current, edited: true })); patch({ mode: 'read', notice: 'Зміни збережено у цьому прикладі.' }) })
    }
    if (action === 'archive') patch({ mode: 'archive', menuOpen: false })
    if (action === 'cancel-archive') patch({ mode: 'read' })
    if (action === 'confirm-archive') { patch({ mode: 'archiving' }); later(() => patch({ mode: 'archived' })) }
    if (action === 'undo') patch({ mode: 'read' })
    if (action === 'acknowledge' && item.acknowledgement) {
      setItem((current) => ({ ...current, acknowledgement: { ...current.acknowledgement!, state: 'loading' } }))
      later(() => setItem((current) => ({ ...current, acknowledgement: { ...current.acknowledgement!, state: 'done' } })))
    }
    if (action === 'like') {
      patch({ liking: true })
      later(() => { setItem((current) => ({ ...current, liked: !current.liked, likes: Math.max(0, (current.likes ?? 0) + (current.liked ? -1 : 1)) })); patch({ liking: false }) })
    }
    if (action === 'cancel-reply') patch({ replyTo: null })
    if (action === 'send' && !state.sending && !commentPhotos.busy && (state.comment.trim() || commentPhotos.photos.length)) {
      patch({ sending: true })
      later(() => {
        setItem((current) => ({ ...current, comments: [...current.comments ?? [], { id: `${editorId}-${Date.now()}`, body: state.comment.trim(), photos: [...commentPhotos.photos], author: people.maria, createdAt: new Date().toISOString(), editedAt: null, replyToCommentId: state.replyTo, mentions: [] }] }))
        commentPhotos.clearDraft()
        patch({ sending: false, comment: '', replyTo: null })
      })
    }
  }
  return <>
    <FeedCardDesign item={item} state={state} editorId={editorId} onAction={handleAction} onProfile={openProfile}
      onBodyChange={(body) => setItem((current) => ({ ...current, body }))}
      onCommentChange={(comment) => patch({ comment })}
      commentPhotos={commentPhotos}
      onReply={(replyTo) => patch({ replyTo, comment: '' })}
      onFile={(file, action) => action === 'preview' ? setDialog(file) : patch({ notice: 'У галереї показано дію завантаження. Демонстраційний файл не завантажується.' })}
    />
    {dialog && <Modal title={typeof dialog === 'object' ? dialog.fileName : dialog === 'profile' ? 'Профіль користувача' : item.title ?? 'Деталі запису'} size={typeof dialog === 'object' ? 'lg' : 'md'} onRequestClose={() => setDialog(null)}>
      {typeof dialog === 'object' ? <div className="showcase-file-preview">
        <span className="showcase-dialog-note">Демонстраційний вміст · {dialog.mimeType === 'image/webp' ? 'зображення' : dialog.mimeType === 'text/plain' ? 'текст' : 'документ'}</span>
        {dialog.mimeType.startsWith('image/') ? <img src="/assets/auth/editorial-workspace.png" alt="Приклад зображення робочого простору" /> : <div className="showcase-document"><FileText size={30} /><h2>План роботи команди</h2><p>Матеріали до зустрічі · 28 жовтня 2026</p><hr /><h3>Наступні кроки</h3><ol><li>Узгодити порядок денний зустрічі.</li><li>Підготувати матеріали для обговорення.</li><li>Зафіксувати рішення й відповідальних.</li></ol><p>Це приклад для перевірки вигляду та взаємодії перегляду файлу.</p></div>}
        <Button type="button" variant="secondary" onClick={() => { setDialog(null); patch({ notice: 'Дія завантаження перевірена на демонстраційному прикладі.' }) }}><Download size={16} />Завантажити</Button>
      </div> : dialog === 'profile' ? <div className="showcase-profile"><Avatar name={profile?.displayName ?? 'Користувач'} src={profile?.avatarAsset} size="lg" /><h2>{profile?.displayName}</h2><p>Демонстраційний профіль користувача</p></div> : <div className="showcase-source-details"><span className="showcase-dialog-note">Демонстраційні деталі</span><h2>{item.title}</h2><FeedMetadata entries={item.metadata} onProfile={openProfile} /><p>У робочій стрічці ця дія відкриває відповідне завдання або подію календаря.</p><Button type="button" variant="secondary" onClick={() => setDialog(null)}>Повернутися до прикладу<ArrowRight size={16} /></Button></div>}
    </Modal>}
  </>
}
