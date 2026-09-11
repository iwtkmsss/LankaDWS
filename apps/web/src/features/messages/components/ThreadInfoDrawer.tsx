import type { ChatContactUser, ChatParticipantView, ChatThreadDetail } from '@lankadws/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Crown, LogOut, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, idempotencyKey, jsonBody } from '../../../shared/api/client'
import { useDebouncedSearchValue } from '../../../shared/lib/useDebouncedSearchValue'
import { Avatar, Button, Drawer, Skeleton } from '../../../shared/ui'
import { searchChatUsers } from '../api/messageApi'
import { messageKeys } from '../api/messageKeys'
import { normalizedCodePointLength } from '../lib/messageText'
import { UserProfileLink } from '../../employees/UserProfileDrawer'

export function ThreadInfoDrawer({
  thread,
  currentUserId,
  onClose,
  onLeft,
}: {
  thread: ChatThreadDetail
  currentUserId: string
  onClose: () => void
  onLeft: () => void
}) {
  const client = useQueryClient()
  const [query, setQuery] = useState('')
  const {
    debouncedValue: debounced,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query)
  const [error, setError] = useState('')
  const users = useQuery({
    queryKey: messageKeys.users(thread.companyId, debounced),
    queryFn: ({ signal }) => searchChatUsers(thread.companyId, debounced, signal),
    enabled: thread.canManageParticipants && !isComposing && normalizedCodePointLength(debounced) >= 1,
  })
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: messageKeys.detail(thread.id) }),
    client.invalidateQueries({ queryKey: [...messageKeys.all, 'threads'] }),
  ])
  const preference = useMutation({
    mutationFn: () => api(`/messages/threads/${thread.id}/preferences`, {
      method: 'PUT',
      body: jsonBody({
        notificationMode: thread.notificationMode === 'NONE' ? 'ALL' : 'NONE',
        expectedVersion: thread.participantVersion,
      }),
    }),
    onSuccess: refresh,
  })
  const add = useMutation({
    mutationFn: (contact: ChatContactUser) => api(`/messages/threads/${thread.id}/participants`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey('chat-participant') },
      body: jsonBody({
        userId: contact.id,
        role: 'MEMBER',
        expectedThreadVersion: thread.version,
      }),
    }),
    onSuccess: async () => {
      setQuery('')
      setError('')
      await refresh()
    },
    onError: () => setError('Склад діалогу вже міг змінитися. Оновіть і спробуйте ще раз.'),
  })
  const update = useMutation({
    mutationFn: ({ participant, role }: { participant: ChatParticipantView; role: 'OWNER' | 'MEMBER' }) =>
      api(`/messages/threads/${thread.id}/participants/${participant.id}`, {
        method: 'PUT',
        body: jsonBody({
          role,
          expectedVersion: participant.version,
          expectedThreadVersion: thread.version,
        }),
      }),
    onSuccess: refresh,
    onError: () => setError('Не вдалося змінити роль. Оновіть склад діалогу.'),
  })
  const remove = useMutation({
    mutationFn: (participant: ChatParticipantView) =>
      api(`/messages/threads/${thread.id}/participants/${participant.id}`, {
        method: 'DELETE',
        body: jsonBody({
          expectedVersion: participant.version,
          expectedThreadVersion: thread.version,
        }),
      }),
    onSuccess: async (_, participant) => {
      if (participant.id === currentUserId) onLeft()
      else await refresh()
    },
    onError: () => setError('Не вдалося змінити склад групи. У групі має лишитися власник.'),
  })
  const pending = preference.isPending || add.isPending || update.isPending || remove.isPending
  const participantIds = new Set(thread.participants.map((participant) => participant.id))
  const availableUsers = users.data?.items.filter((contact) => !participantIds.has(contact.id)) ?? []

  return (
    <Drawer
      title="Інформація про діалог"
      onRequestClose={() => onClose()}
      footer={thread.canLeave ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            const current = thread.participants.find((participant) => participant.id === currentUserId)
            if (current) remove.mutate(current)
          }}
        >
          <LogOut size={17} /> Вийти з діалогу
        </Button>
      ) : undefined}
    >
      <div className="thread-info">
        <section className="thread-info__summary">
          <span className="thread-info__avatar">
            {thread.kind === 'DIRECT'
              ? <Avatar size="lg" name={thread.title} src={thread.participants.find((participant) => participant.id !== currentUserId)?.avatarAsset} />
              : <Avatar size="lg" name={thread.title} />}
          </span>
          <h2>{thread.title}</h2>
          <p>{thread.kind === 'DIRECT' ? 'Особистий діалог' : `${thread.participants.length} учасників`}</p>
        </section>

        <button
          type="button"
          className="thread-info__setting"
          disabled={preference.isPending}
          onClick={() => preference.mutate()}
        >
          {thread.notificationMode === 'NONE' ? <BellOff size={19} /> : <Bell size={19} />}
          <span>
            <strong>Сповіщення</strong>
            <small>{thread.notificationMode === 'NONE' ? 'Вимкнені' : 'Усі повідомлення'}</small>
          </span>
        </button>

        <section className="thread-info__participants">
          <h3>Учасники</h3>
          {thread.participants.map((participant) => (
            <article key={participant.id}>
              {participant.id === currentUserId ? (
                <div className="thread-info__participant-profile">
                  <Avatar name={participant.displayName} src={participant.avatarAsset} />
                  <span>
                    <strong>{participant.displayName} · ви</strong>
                    <small>@{participant.username}{participant.jobTitle ? ` · ${participant.jobTitle}` : ''}</small>
                  </span>
                </div>
              ) : (
                <UserProfileLink
                  className="thread-info__participant-profile"
                  userId={participant.id}
                  onClick={() => onClose()}
                >
                  <Avatar name={participant.displayName} src={participant.avatarAsset} />
                  <span>
                    <strong>{participant.displayName}</strong>
                    <small>@{participant.username}{participant.jobTitle ? ` · ${participant.jobTitle}` : ''}</small>
                  </span>
                </UserProfileLink>
              )}
              {participant.role === 'OWNER' && <Crown size={16} aria-label="Власник" />}
              {thread.canManageParticipants && (
                <div>
                  <select
                    aria-label={`Роль: ${participant.displayName}`}
                    value={participant.role}
                    disabled={pending}
                    onChange={(event) => update.mutate({
                      participant,
                      role: event.target.value as 'OWNER' | 'MEMBER',
                    })}
                  >
                    <option value="MEMBER">Учасник</option>
                    <option value="OWNER">Власник</option>
                  </select>
                  {participant.id !== currentUserId && (
                    <button
                      type="button"
                      aria-label={`Прибрати ${participant.displayName}`}
                      disabled={pending}
                      onClick={() => remove.mutate(participant)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>

        {thread.canManageParticipants && thread.participants.length < 50 && (
          <section className="thread-info__add">
            <h3><Plus size={17} /> Додати учасника</h3>
            <label>
              <Search size={17} />
              <input
                value={query}
                placeholder="Ім’я або нікнейм"
                onChange={(event) => setQuery(event.target.value)}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
              />
            </label>
            {users.isLoading ? <Skeleton rows={3} /> : (
              <div>
                {availableUsers.map((contact) => (
                  <button type="button" key={contact.id} disabled={pending} onClick={() => add.mutate(contact)}>
                    <Avatar name={contact.displayName} src={contact.avatarAsset} />
                    <span><strong>{contact.displayName}</strong><small>@{contact.username}</small></span>
                    <Plus size={16} />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Drawer>
  )
}
