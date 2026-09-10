import type { ChatAttachmentView, ChatMessageView, StructuredMentionInput } from '@bert-crm/contracts'
import { FileText, LoaderCircle, Paperclip, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { MentionTextarea } from '../../../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../../../shared/mentions/mentionText'
import { replyPreviewText } from '../lib/replyPreview'

interface MessageComposerProps {
  threadId: string
  initialBody?: string
  onInitialBodyConsumed?: () => void
  replyTo: ChatMessageView | null
  attachments: ChatAttachmentView[]
  sending: boolean
  uploading: boolean
  error: string
  onReplyCancel: () => void
  onRemoveAttachment: (id: string) => void
  onFiles: (files: File[]) => void
  onSend: (input: { body: string; mentions: StructuredMentionInput[] }) => Promise<boolean>
}

function draftKey(threadId: string): string {
  return `bertcrm:message-draft:${threadId}`
}

function storedDraft(threadId: string): string {
  try {
    return window.sessionStorage.getItem(draftKey(threadId)) ?? ''
  } catch {
    return ''
  }
}

function storeDraft(threadId: string, body: string): void {
  try {
    if (body) window.sessionStorage.setItem(draftKey(threadId), body)
    else window.sessionStorage.removeItem(draftKey(threadId))
  } catch {
    // The in-memory draft remains available when browser storage is blocked.
  }
}

export function MessageComposer(props: MessageComposerProps) {
  const [body, setBody] = useState(() => props.initialBody ?? storedDraft(props.threadId))
  const [mentions, setMentions] = useState<StructuredMentionInput[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (props.initialBody) props.onInitialBodyConsumed?.()
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [props.threadId])

  useEffect(() => {
    storeDraft(props.threadId, body)
  }, [body, props.threadId])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0'
    textarea.style.height = `${Math.min(144, textarea.scrollHeight)}px`
  }, [body])

  async function submit() {
    const value = trimMentionValue(body, mentions)
    if ((!value.body && props.attachments.length === 0) || props.sending || submittingRef.current) return
    submittingRef.current = true
    try {
      const sent = await props.onSend(value)
      if (sent) {
        setBody('')
        setMentions([])
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    } finally {
      submittingRef.current = false
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files]
    if (!files.length) return

    event.preventDefault()
    const availableSlots = 5 - props.attachments.length
    if (availableSlots > 0 && !props.uploading) props.onFiles(files.slice(0, availableSlots))
  }

  const attachmentsFull = props.attachments.length >= 5

  return (
    <div className="message-composer">
      {props.replyTo && (
        <div className="message-composer__reply">
          <span>
            <strong>Відповідь: {props.replyTo.author.displayName}</strong>
            <small>{replyPreviewText(props.replyTo)}</small>
          </span>
          <button type="button" aria-label="Скасувати відповідь" onClick={props.onReplyCancel}>
            <X size={17} />
          </button>
        </div>
      )}
      {props.attachments.length > 0 && (
        <div className="message-composer__attachments">
          {props.attachments.map((attachment) => (
            <span key={attachment.id}>
              <FileText size={15} />
              {attachment.fileName}
              <button
                type="button"
                aria-label={`Прибрати ${attachment.fileName}`}
                onClick={() => props.onRemoveAttachment(attachment.id)}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="message-composer__row">
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          disabled={props.uploading || attachmentsFull}
          onChange={(event) => {
            props.onFiles([...event.target.files ?? []].slice(0, 5 - props.attachments.length))
            event.target.value = ''
          }}
        />
        <button
          type="button"
          aria-label="Додати файли"
          title="Додати файли або перетягнути їх у поле вводу"
          disabled={props.uploading || attachmentsFull}
          onClick={() => inputRef.current?.click()}
        >
          {props.uploading
            ? <LoaderCircle className="is-spinning" size={20} />
            : <Paperclip size={21} />}
        </button>
        <MentionTextarea
          className="message-composer__input"
          label="Повідомлення"
          visuallyHiddenLabel
          autoFocus
          value={body}
          mentions={mentions}
          candidateUrl={`/messages/threads/${encodeURIComponent(props.threadId)}/mention-candidates`}
          rows={1}
          maxLength={8_000}
          placeholder="Напишіть повідомлення…"
          disabled={props.sending}
          onTextareaRef={(element) => { textareaRef.current = element }}
          onChange={(nextBody, nextMentions) => {
            setBody(nextBody)
            setMentions(nextMentions)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void submit()
          }}
          onPaste={handlePaste}
        />
        <button
          type="button"
          className="message-composer__send"
          aria-label="Надіслати"
          disabled={(!body.trim() && props.attachments.length === 0) || props.sending}
          onClick={() => void submit()}
        >
          {props.sending
            ? <LoaderCircle className="is-spinning" size={20} />
            : <Send size={20} />}
        </button>
      </div>
      <div className="message-composer__status" role="status" aria-live="polite">
        {props.error}
      </div>
    </div>
  )
}
