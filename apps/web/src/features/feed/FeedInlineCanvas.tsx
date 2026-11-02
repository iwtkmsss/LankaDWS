import type { CSSProperties, ReactNode } from 'react'
import type { FeedAttachmentView, FeedPhotoPlacement } from '@lankadws/contracts'
import { layoutDepth } from './feedInlinePhotos'
import './feed-inline-photos.css'

export interface PlacedFeedPhoto { placement: FeedPhotoPlacement; file: FeedAttachmentView }

/** Lays stored photos over the post text exactly where the author placed them. */
export function FeedInlineCanvas({ photos, renderPhoto, children }: {
  photos: PlacedFeedPhoto[]
  renderPhoto: (file: FeedAttachmentView) => ReactNode
  children?: ReactNode
}) {
  if (!photos.length) return <>{children}</>
  const depth = layoutDepth(photos.map(({ placement }) => placement))
  return <div className="feed-inline-canvas">
    {children}
    <div className="feed-inline-canvas__photos" style={{ '--feed-inline-depth': depth } as CSSProperties}>
      {photos.map(({ placement, file }) => <div key={file.id} className="feed-inline-canvas__photo"
        style={{ '--x': placement.x, '--y': placement.y, '--w': placement.width, '--h': placement.height } as CSSProperties}>
        {renderPhoto(file)}
      </div>)}
    </div>
  </div>
}

export function placedPhotos(layout: FeedPhotoPlacement[] | undefined, attachments: FeedAttachmentView[] | undefined): PlacedFeedPhoto[] {
  return (layout ?? []).flatMap((placement) => {
    const file = attachments?.find((entry) => entry.id === placement.fileId)
    return file ? [{ placement, file }] : []
  })
}
