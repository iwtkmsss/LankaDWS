import { FEED_PHOTO_MIME_TYPES, feedPhotoPlacementSchema, type FeedPhotoPlacement } from '@lankadws/contracts'

export function isLayoutPhoto(file: { detectedMime: string | null; declaredMime: string | null }): boolean {
  const mime = file.detectedMime ?? file.declaredMime
  return FEED_PHOTO_MIME_TYPES.some((photoMime) => photoMime === mime)
}

export function serializePhotoLayout(layout: FeedPhotoPlacement[]): string | null {
  return layout.length ? JSON.stringify(layout) : null
}

// Stored layout is trusted only for photos that are still attached.
export function parsePhotoLayout(
  stored: string | null,
  attachments: Array<{ id: string; mimeType: string }>,
): FeedPhotoPlacement[] {
  if (!stored) return []
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const photoIds = new Set(
    attachments
      .filter((file) => FEED_PHOTO_MIME_TYPES.some((mime) => mime === file.mimeType))
      .map((file) => file.id),
  )
  return raw.flatMap((entry) => {
    const parsed = feedPhotoPlacementSchema.safeParse(entry)
    return parsed.success && photoIds.has(parsed.data.fileId) ? [parsed.data] : []
  })
}
