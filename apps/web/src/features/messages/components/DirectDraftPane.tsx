import type { ChatContactUser } from '@bert-crm/contracts'
import { ArrowLeft, LoaderCircle, Send } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Avatar, Button, IconButton } from '../../../shared/ui'

export function DirectDraftPane({
  contact,
  body,
  creating,
  error,
  onBack,
  onBodyChange,
  onRetry,
}: {
  contact: ChatContactUser
  body: string
  creating: boolean
  error: string
  onBack: () => void
  onBodyChange: (value: string) => void
  onRetry: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [contact.id])

  return (
    <section className="conversation-pane" aria-label={`Діалог: ${contact.displayName}`}>
      <header className="conversation-header">
        <IconButton className="conversation-header__back" label="До списку діалогів" onClick={onBack}>
          <ArrowLeft size={21} />
        </IconButton>
        <Avatar name={contact.displayName} src={contact.avatarAsset} />
        <div className="conversation-header__copy">
          <h1>{contact.displayName}</h1>
          <span>@{contact.username}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</span>
        </div>
      </header>

      <div className="direct-draft__empty">
        <Avatar size="lg" name={contact.displayName} src={contact.avatarAsset} />
        <strong>Почніть розмову з {contact.displayName}</strong>
        <span>Діалог з’явиться у списку після першого повідомлення.</span>
      </div>

      <div className="message-composer direct-draft__composer">
        <div className="message-composer__row">
          <textarea
            ref={textareaRef}
            autoFocus
            className="message-composer__input"
            aria-label="Повідомлення"
            rows={1}
            maxLength={8_000}
            value={body}
            placeholder="Напишіть повідомлення…"
            onChange={(event) => onBodyChange(event.target.value)}
          />
          <button type="button" className="message-composer__send" aria-label="Надіслати" disabled>
            {creating ? <LoaderCircle className="is-spinning" size={20} /> : <Send size={20} />}
          </button>
        </div>
        <div className="message-composer__status" role="status" aria-live="polite">
          {creating ? 'Зберігаємо чат…' : error}
          {error && (
            <Button type="button" variant="ghost" onClick={onRetry}>Спробувати ще раз</Button>
          )}
        </div>
      </div>
    </section>
  )
}
