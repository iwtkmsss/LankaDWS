import type { ChatContactUser } from '@lankadws/contracts'
import { ArrowLeft, LoaderCircle, Paperclip, Send } from 'lucide-react'
import { useEffect, useRef, type ClipboardEvent } from 'react'
import { MessageComposerFrame } from '../../../shared/messages/MessageComposerFrame'
import { Avatar, IconButton } from '../../../shared/ui'

export function DirectDraftPane({
  contact,
  body,
  creating,
  onBack,
  onBodyChange,
  onFiles,
}: {
  contact: ChatContactUser
  body: string
  creating: boolean
  onBack: () => void
  onBodyChange: (value: string) => void
  onFiles: (files: File[]) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: File[]) {
    if (files.length && !creating) onFiles(files)
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files]
    if (!files.length) return
    event.preventDefault()
    addFiles(files)
  }

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

      <MessageComposerFrame
        className="direct-draft__composer"
        leadingActions={(
          <>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              disabled={creating}
              onChange={(event) => {
                addFiles([...event.target.files ?? []])
                event.target.value = ''
              }}
            />
            <button type="button" aria-label="Додати файли" disabled={creating} onClick={() => inputRef.current?.click()}>
              <Paperclip size={21} />
            </button>
          </>
        )}
        input={(
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
            onPaste={handlePaste}
          />
        )}
        sendAction={(
          <button type="button" className="message-composer__send" aria-label="Надіслати" disabled>
            {creating ? <LoaderCircle className="is-spinning" size={20} /> : <Send size={20} />}
          </button>
        )}
      />
    </section>
  )
}
