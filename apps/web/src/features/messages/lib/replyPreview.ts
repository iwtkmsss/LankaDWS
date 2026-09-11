import type { ChatMessageView } from '@lankadws/contracts'

export function replyPreviewText(message: ChatMessageView): string {
  if (message.attachments.some((attachment) => attachment.mimeType?.startsWith('image/'))) return 'Фото'
  return message.body.trim().replace(/\s+/g, ' ').slice(0, 180)
}
