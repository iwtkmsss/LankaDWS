import type { ChatContactUser } from '@bert-crm/contracts'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BellRing, Search, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, idempotencyKey, jsonBody } from '../../shared/api/client'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'
import { Avatar, Button, Drawer, Skeleton } from '../../shared/ui'
import { searchChatUsers } from '../messages/api/messageApi'
import { messageKeys } from '../messages/api/messageKeys'
import { normalizedCodePointLength } from '../messages/lib/messageText'

export function SendNotificationDrawer({
  companyId,
  onClose,
  onSent,
}: {
  companyId: string
  onClose: () => void
  onSent: (contact: ChatContactUser) => void
}) {
  const [query, setQuery] = useState('')
  const [recipient, setRecipient] = useState<ChatContactUser | null>(null)
  const [error, setError] = useState('')
  const {
    debouncedValue,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query)
  const searching = !recipient && !isComposing && normalizedCodePointLength(debouncedValue) >= 1
  const users = useQuery({
    queryKey: messageKeys.users(companyId, debouncedValue),
    queryFn: ({ signal }) => searchChatUsers(companyId, debouncedValue, signal),
    enabled: searching,
  })
  const send = useMutation({
    mutationFn: (input: { title: string; body: string }) => api('/notifications', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey('manual-notification') },
      body: jsonBody({ recipientId: recipient!.id, ...input }),
    }),
    onSuccess: () => {
      setError('')
      onSent(recipient!)
    },
    onError: () => setError('Не вдалося надіслати сповіщення. Перевірте дані та повторіть спробу.'),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!recipient || send.isPending) return
    const data = new FormData(event.currentTarget)
    send.mutate({ title: String(data.get('title')), body: String(data.get('body')) })
  }

  return (
    <Drawer
      title="Нове сповіщення"
      onRequestClose={onClose}
      footer={<Button type="button" variant="secondary" onClick={onClose}>Скасувати</Button>}
    >
      <form className="notification-compose" onSubmit={submit}>
        <label>
          Одержувач
          {recipient ? (
            <span className="notification-compose__recipient">
              <Avatar name={recipient.displayName} src={recipient.avatarAsset} />
              <span><strong>{recipient.displayName}</strong><small>@{recipient.username}</small></span>
              <button
                type="button"
                aria-label="Змінити одержувача"
                onClick={() => {
                  setRecipient(null)
                  setQuery('')
                }}
              ><X size={16} /></button>
            </span>
          ) : (
            <span className="notification-compose__search">
              <Search size={17} />
              <input
                role="combobox"
                aria-label="Пошук одержувача"
                aria-expanded={searching}
                aria-controls={searching ? 'notification-recipient-results' : undefined}
                value={query}
                placeholder="Ім’я або нікнейм"
                onChange={(event) => setQuery(event.target.value)}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
              />
            </span>
          )}
        </label>
        {!recipient && searching && (
          <div id="notification-recipient-results" className="notification-compose__results" role="listbox">
            {users.isLoading ? <Skeleton rows={4} /> : users.data?.items.length ? users.data.items.map((contact) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={contact.id}
                onClick={() => {
                  setRecipient(contact)
                  setQuery('')
                }}
              >
                <Avatar name={contact.displayName} src={contact.avatarAsset} />
                <span><strong>{contact.displayName}</strong><small>@{contact.username}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</small></span>
              </button>
            )) : <p>Користувачів не знайдено.</p>}
          </div>
        )}
        <label>
          Заголовок
          <input name="title" required minLength={2} maxLength={120} placeholder="Коротко про головне" />
        </label>
        <label>
          Текст сповіщення
          <textarea name="body" required maxLength={500} rows={5} placeholder="Напишіть повідомлення для одержувача" />
        </label>
        <p className="notification-compose__error" role="status" aria-live="polite">{error}</p>
        <Button type="submit" disabled={!recipient || send.isPending}>
          <BellRing size={17} /> {send.isPending ? 'Надсилаємо…' : 'Надіслати сповіщення'}
        </Button>
      </form>
    </Drawer>
  )
}
