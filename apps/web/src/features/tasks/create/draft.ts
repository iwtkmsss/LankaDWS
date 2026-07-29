import type { TaskCreateDraft } from './types'

const draftLifetimeMs = 7 * 86_400_000
const attachmentLifetimeMs = 86_400_000

interface StoredTaskDraft {
  savedAt: string
  value: TaskCreateDraft
}

export function taskDraftKey(userId: string, groupId: string): string {
  return `bertcrm:task-create:v2:${userId}:${groupId || 'organization'}`
}

export function loadTaskDraft(key: string): TaskCreateDraft | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as StoredTaskDraft | null
    if (
      !stored
      || Date.now() - new Date(stored.savedAt).getTime() > draftLifetimeMs
    ) {
      localStorage.removeItem(key)
      return null
    }
    return {
      ...stored.value,
      attachments: stored.value.attachments.filter((attachment) => (
        Date.now() - new Date(attachment.stagedAt).getTime() < attachmentLifetimeMs
      )),
    }
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

export function saveTaskDraft(key: string, value: TaskCreateDraft): void {
  const stored: StoredTaskDraft = {
    savedAt: new Date().toISOString(),
    value,
  }
  localStorage.setItem(key, JSON.stringify(stored))
}

export function clearTaskDraft(key: string): void {
  localStorage.removeItem(key)
}
