import type { ChatAttachmentView } from '@lankadws/contracts'
import { isPreviewableImage } from '../../../shared/files/filePreview'

export const PHOTO_ALBUM_LIMIT = 10

export function isChatPhoto(attachment: Pick<ChatAttachmentView, 'mimeType'>): boolean {
  return isPreviewableImage(attachment.mimeType)
}

export function photoAttachmentBatches<T extends Pick<ChatAttachmentView, 'mimeType'>>(attachments: T[]): T[][] {
  if (!attachments.length || !attachments.every(isChatPhoto)) return [attachments]
  const batches: T[][] = []
  for (let start = 0; start < attachments.length; start += PHOTO_ALBUM_LIMIT) {
    batches.push(attachments.slice(start, start + PHOTO_ALBUM_LIMIT))
  }
  return batches
}
