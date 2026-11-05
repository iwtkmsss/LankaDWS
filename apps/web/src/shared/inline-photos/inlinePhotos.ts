import type { FeedPhotoPlacement } from '@lankadws/contracts'

// Every placement coordinate is a fraction of the text block width, so a
// layout drawn in an editor scales proportionally wherever the text is shown.
export interface InlinePhoto {
  id: string
  src: string
  name: string
  ratio: number
  x: number
  y: number
  width: number
}

export interface PhotoBounds { width: number; height: number }
export interface PhotoRect { x: number; y: number; width: number; height: number }

const MIN_PHOTO_PX = 64
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max))

export function initialPlacement(index: number): Pick<InlinePhoto, 'x' | 'y' | 'width'> {
  return { x: .05, y: .03 + index * .05, width: .5 }
}

export function fitPhoto(photo: Pick<InlinePhoto, 'x' | 'y' | 'width' | 'ratio'>, bounds: PhotoBounds): PhotoRect {
  const width = Math.min(Math.max(MIN_PHOTO_PX, clamp(photo.width, .05, 1) * bounds.width), bounds.width, bounds.height * photo.ratio)
  const height = width / photo.ratio
  return {
    x: clamp(photo.x * bounds.width, 0, bounds.width - width),
    y: clamp(photo.y * bounds.width, 0, bounds.height - height),
    width,
    height,
  }
}

export function rectToPlacement(rect: PhotoRect, bounds: PhotoBounds): Pick<InlinePhoto, 'x' | 'y' | 'width'> {
  return { x: rect.x / bounds.width, y: rect.y / bounds.width, width: rect.width / bounds.width }
}

export function resizePhoto(rect: PhotoRect, ratio: number, bounds: PhotoBounds, corner: string, dx: number, dy: number): PhotoRect {
  const left = corner.includes('left'), top = corner.includes('top')
  const anchorX = left ? rect.x + rect.width : rect.x
  const anchorY = top ? rect.y + rect.height : rect.y
  const delta = Math.abs(dx) >= Math.abs(dy * ratio) ? (left ? -dx : dx) : (top ? -dy : dy) * ratio
  const maximum = Math.min(left ? anchorX : bounds.width - anchorX, (top ? anchorY : bounds.height - anchorY) * ratio)
  const width = clamp(rect.width + delta, Math.min(MIN_PHOTO_PX, maximum), maximum)
  const height = width / ratio
  return { x: left ? anchorX - width : anchorX, y: top ? anchorY - height : anchorY, width, height }
}

/** Serializes draft photos into the contract layout, keeping each photo inside the block. */
export function toPhotoLayout(photos: Pick<InlinePhoto, 'id' | 'ratio' | 'x' | 'y' | 'width'>[]): FeedPhotoPlacement[] {
  return photos.map((photo) => {
    const width = clamp(photo.width, .05, 1)
    return {
      fileId: photo.id,
      x: round(clamp(photo.x, 0, 1 - width)),
      y: round(clamp(photo.y, 0, 20)),
      width: round(width),
      height: round(clamp(width / photo.ratio, .01, 20)),
    }
  })
}

/** Height of the placed photos, as a fraction of the block width. */
export function layoutDepth(layout: Pick<FeedPhotoPlacement, 'y' | 'height'>[]): number {
  return layout.reduce((depth, placement) => Math.max(depth, placement.y + placement.height), 0)
}

/** The stored height keeps the photo proportions, so an editor can restore them. */
export function placementToPhoto(placement: FeedPhotoPlacement, file: { id: string; fileName: string }, src: string): InlinePhoto {
  return { id: file.id, name: file.fileName, src, ratio: placement.width / placement.height, x: placement.x, y: placement.y, width: placement.width }
}

const DEFAULT_RATIO = 4 / 3

// Waits for the load event: image.decode() can stall while the page is in a background tab.
export function imageRatio(src: string): Promise<number> {
  const image = new Image()
  if (typeof image.decode !== 'function') return Promise.resolve(DEFAULT_RATIO)
  return new Promise((resolve) => {
    image.onload = () => resolve(image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : DEFAULT_RATIO)
    image.onerror = () => resolve(DEFAULT_RATIO)
    image.src = src
  })
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000
}
