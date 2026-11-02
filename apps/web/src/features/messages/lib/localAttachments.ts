import type { ChatAttachmentView } from '@lankadws/contracts'
import { validMessageFiles } from '../../../shared/files/uploadValidation'

interface LocalAttachment {
  file: File
  uploaded: Map<string, ChatAttachmentView>
}
const files = new WeakMap<object, LocalAttachment>()
let nextId = 0

export function stageMessageFiles(selected: File[]): ChatAttachmentView[] {
  return validMessageFiles(selected).map((file) => {
    const attachment: ChatAttachmentView = {
      id: `local-attachment:${++nextId}`, fileName: file.name, bytes: file.size,
      mimeType: file.type || null, scanStatus: 'QUARANTINED',
    }
    files.set(attachment, { file, uploaded: new Map() })
    return attachment
  })
}

export function localAttachment(attachment: Pick<ChatAttachmentView, 'id' | 'mimeType'>): LocalAttachment | undefined {
  return files.get(attachment)
}

export function isLocalAttachmentId(id: string): boolean {
  return id.startsWith('local-attachment:')
}
