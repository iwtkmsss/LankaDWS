import { ResizableTextarea } from '../../shared/ui/ResizableTextarea'
import { useRef, useState } from 'react'
import { ImagePlus, Send, X } from 'lucide-react'
import { Button, IconButton, Modal } from '../../shared/ui'
import { SHOWCASE_PHOTO_ACCEPT, SHOWCASE_PHOTO_LIMIT, type ShowcasePhoto, type ShowcasePhotoDraft } from './showcasePhotos'
import './showcase-photos.css'

export function ShowcasePhotoPreviews({ photos, onRemove, disabled }: { photos: ShowcasePhoto[]; onRemove?: (id: string) => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<ShowcasePhoto | null>(null)
  return <>
    <div className="showcase-photo-previews">
      {photos.map((photo) => <div key={photo.id} className="showcase-photo-preview">
        <button type="button" className="showcase-photo-preview__open" aria-label={`Переглянути ${photo.name}`} onClick={() => setPreview(photo)}><img src={photo.src} alt={photo.name} /></button>
        {onRemove && <IconButton label={`Прибрати ${photo.name}`} disabled={disabled} onClick={() => onRemove(photo.id)}><X size={15} /></IconButton>}
      </div>)}
    </div>
    {preview && <Modal title={preview.name} size="lg" onRequestClose={() => setPreview(null)}><img className="showcase-photo-full" src={preview.src} alt={preview.name} /></Modal>}
  </>
}

export function ShowcaseCommentComposer({ id, value, onChange, photos, sending, reply, replyPreview, onCancelReply, onSend }: {
  id: string; value: string; onChange: (value: string) => void; photos: ShowcasePhotoDraft; sending: boolean
  reply?: string; replyPreview?: string; onCancelReply: () => void; onSend: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const disabled = sending || photos.busy
  return <form className={`stream-comment-form${reply ? ' is-replying' : ''}`} onSubmit={(event) => { event.preventDefault(); if (!disabled && (value.trim() || photos.photos.length)) onSend() }}>
    {reply && <div className="stream-reply-to"><div><span>У відповідь <strong>{reply}</strong></span>{replyPreview && <p>{replyPreview}</p>}</div><IconButton label="Скасувати відповідь" disabled={disabled} onClick={onCancelReply}><X size={13} /></IconButton></div>}
    <label htmlFor={id} className={reply ? 'sr-only' : undefined}>{reply ? 'Ваша відповідь' : 'Новий коментар'}</label>
    <ResizableTextarea id={id} placeholder="Додайте коментар або вставте скріншот…" maxLength={4000} rows={2} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} onPaste={(event) => {
      const files = Array.from(event.clipboardData.files)
      if (files.length) { event.preventDefault(); void photos.add(files) }
    }} />
    <input ref={input} type="file" hidden accept={SHOWCASE_PHOTO_ACCEPT} multiple disabled={disabled} aria-label="Фото до коментаря" onChange={(event) => { void photos.add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    {photos.photos.length > 0 && <ShowcasePhotoPreviews photos={photos.photos} onRemove={photos.remove} disabled={disabled} />}
    {photos.error && <p className="showcase-photo-error" role="alert">{photos.error}</p>}
    <div className="showcase-comment-actions"><Button type="button" variant="secondary" disabled={disabled || photos.photos.length >= SHOWCASE_PHOTO_LIMIT} onClick={() => input.current?.click()}><ImagePlus size={16} />{photos.busy ? 'Додаємо фото…' : 'Фото'}</Button><Button disabled={disabled || (!value.trim() && !photos.photos.length)}><Send size={15} />{sending ? 'Надсилаємо…' : 'Надіслати'}</Button></div>
  </form>
}
