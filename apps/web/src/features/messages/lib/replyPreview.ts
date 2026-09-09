import type { ChatMessageView } from '@bert-crm/contracts'

export function replyPreviewText(message: ChatMessageView): string {
  if (message.attachments.some((attachment) => attachment.mimeType?.startsWith('image/'))) return 'Фото'
  return message.body.trim().replace(/\s+/g, ' ').slice(0, 180)
}
