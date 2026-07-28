import type { ChatAttachmentView, ChatMessageView } from '@bert-crm/contracts'
import { FileText, LoaderCircle, Paperclip, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface MessageComposerProps {
  replyTo: ChatMessageView | null
  attachments: ChatAttachmentView[]
  sending: boolean
  uploading: boolean
  error: string
  onReplyCancel: () => void
  onRemoveAttachment: (id: string) => void
  onFiles: (files: File[]) => void
  onSend: (body: string) => Promise<boolean>
}

export function MessageComposer(props: MessageComposerProps) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0'
    textarea.style.height = `${Math.min(144, textarea.scrollHeight)}px`
  }, [body])

  async function submit() {
    if (!body.trim() || props.sending) return
    const sent = await props.onSend(body.trim())
    if (sent) {
      setBody('')
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
        <textarea
          ref={textareaRef}
          rows={1}
          maxLength={8_000}
          value={body}
          aria-label="Повідомлення"
          placeholder="Напишіть повідомлення…"
          onChange={(event) => setBody(event.target.value)}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || composingRef.current || event.nativeEvent.isComposing) return
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
