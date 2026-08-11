import type { ChatAttachmentView, ChatMessageView, StructuredMentionInput } from '@bert-crm/contracts'
import { FileText, LoaderCircle, Paperclip, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MentionTextarea } from '../../../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../../../shared/mentions/mentionText'

interface MessageComposerProps {
  threadId: string
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

export function MessageComposer(props: MessageComposerProps) {
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<StructuredMentionInput[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0'
    textarea.style.height = `${Math.min(144, textarea.scrollHeight)}px`
  }, [body])

  async function submit() {
    const value = trimMentionValue(body, mentions)
    if (!value.body || props.sending) return
    const sent = await props.onSend(value)
    if (sent) {
      setBody('')
      setMentions([])
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  return (
    <div className="message-composer">
      {props.replyTo && (
        <div className="message-composer__reply">
          <span>
            <strong>Відповідь: {props.replyTo.author.displayName}</strong>
            <small>{props.replyTo.body}</small>
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
          disabled={props.uploading || props.attachments.length >= 5}
          onChange={(event) => {
            props.onFiles([...event.target.files ?? []].slice(0, 5 - props.attachments.length))
            event.target.value = ''
          }}
        />
        <button
          type="button"
          aria-label="Додати файли"
          disabled={props.uploading || props.attachments.length >= 5}
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
        />
        <button
          type="button"
          className="message-composer__send"
          aria-label="Надіслати"
          disabled={!body.trim() || props.sending}
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
