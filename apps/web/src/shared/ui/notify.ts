export type NoticeTone = 'success' | 'error'
export type NoticeDetail = {
  tone: NoticeTone
  message: string
  /** Reverts the action; the notice offers «Скасувати» while it is shown. */
  undo?: () => Promise<unknown>
}

export const NOTICE_EVENT = 'lankadws:notice'
/** Legacy file-selection error channel; still emitted by upload validation. */
export const FILE_ERROR_EVENT = 'lankadws:file-error'

function emit(detail: NoticeDetail): void {
  window.dispatchEvent(new CustomEvent<NoticeDetail>(NOTICE_EVENT, { detail }))
}

/** Short green pop-up confirming a completed user action, optionally with an undo. */
export function notifySuccess(message: string, options: { undo?: () => Promise<unknown> } = {}): void {
  emit({ tone: 'success', message, undo: options.undo })
}

/** Red pop-up for an error that has no inline place in the current form. */
export function notifyError(message: string): void {
  emit({ tone: 'error', message })
}
