import { useState } from 'react'
import { X } from 'lucide-react'
import { IconButton, Modal } from '../../shared/ui'
import type { FeedDraftPhoto } from './useFeedCommentPhotos'

export function FeedDraftPhotos({ photos, onRemove, disabled }: { photos: FeedDraftPhoto[]; onRemove: (id: string) => void; disabled?: boolean }) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const preview = photos.find((photo) => photo.attachment.id === previewId)
  return <>
    <div className="stream-photo-previews">{photos.map(({ attachment, src }) => <div className="stream-photo-preview" key={attachment.id}>
      <button type="button" className="stream-photo-preview__open" aria-label={`Переглянути ${attachment.fileName}`} onClick={() => setPreviewId(attachment.id)}><img src={src} alt={attachment.fileName} /></button>
      <IconButton label={`Прибрати ${attachment.fileName}`} disabled={disabled} onClick={() => onRemove(attachment.id)}><X size={15} /></IconButton>
    </div>)}</div>
    {preview && <Modal title={preview.attachment.fileName} size="lg" onRequestClose={() => setPreviewId(null)}><img className="stream-photo-full" src={preview.src} alt={preview.attachment.fileName} /></Modal>}
  </>
}
