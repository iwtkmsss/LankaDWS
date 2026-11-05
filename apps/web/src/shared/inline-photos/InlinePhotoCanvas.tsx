import type { CSSProperties, ReactNode } from 'react'
import type { FeedPhotoPlacement } from '@lankadws/contracts'
import { layoutDepth } from './inlinePhotos'
import './inline-photos.css'

export interface PlacedPhoto<File> { placement: FeedPhotoPlacement; file: File }

/** Lays stored photos over the text exactly where the author placed them. */
export function InlinePhotoCanvas<File extends { id: string }>({ photos, renderPhoto, children }: {
  photos: PlacedPhoto<File>[]
  renderPhoto: (file: File) => ReactNode
  children?: ReactNode
}) {
  if (!photos.length) return <>{children}</>
  const depth = layoutDepth(photos.map(({ placement }) => placement))
  return <div className="inline-photos-canvas">
    {children}
    <div className="inline-photos-canvas__photos" style={{ '--inline-photos-depth': depth } as CSSProperties}>
      {photos.map(({ placement, file }) => <div key={file.id} className="inline-photos-canvas__photo"
        style={{ '--x': placement.x, '--y': placement.y, '--w': placement.width, '--h': placement.height } as CSSProperties}>
        {renderPhoto(file)}
      </div>)}
    </div>
  </div>
}

export function placedPhotos<File extends { id: string }>(layout: FeedPhotoPlacement[] | undefined, attachments: File[] | undefined): PlacedPhoto<File>[] {
  return (layout ?? []).flatMap((placement) => {
    const file = attachments?.find((entry) => entry.id === placement.fileId)
    return file ? [{ placement, file }] : []
  })
}
