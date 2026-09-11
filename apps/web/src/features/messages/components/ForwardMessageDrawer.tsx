import type { ChatMessageView, ChatThreadListItem } from '@lankadws/contracts'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Forward } from 'lucide-react'
import { useState } from 'react'
import { idempotencyKey, randomId } from '../../../shared/api/client'
import { Avatar, Drawer, EmptyState, Skeleton } from '../../../shared/ui'
import { getThreadPage, sendMessage } from '../api/messageApi'
import { messageKeys } from '../api/messageKeys'
import { replyPreviewText } from '../lib/replyPreview'

/**
 * Forwards the text of a message into another conversation. Attachments stay
 * with the original message; the forwarded copy carries the attribution line
 * and the text so the recipient can follow the thread back.
 */
export function ForwardMessageDrawer({
  message,
  companyScope,
  currentThreadId,
  onClose,
  onForwarded,
}: {
  message: ChatMessageView
  companyScope: string
  currentThreadId: string
  onClose: () => void
  onForwarded: (threadId: string) => void
}) {
  const [error, setError] = useState('')
  const threads = useQuery({
    // A key of its own: the sidebar stores an infinite-query shape under the
    // plain thread key, which this flat list cannot read.
    queryKey: [...messageKeys.threads(companyScope, false), 'forward-targets'],
    queryFn: ({ signal }) => getThreadPage(companyScope, false, null, signal),
    enabled: Boolean(companyScope),
  })
  const forward = useMutation({
    mutationFn: (threadId: string) => sendMessage(threadId, {
      body: forwardedBody(message),
      attachmentIds: [],
      mentions: [],
    }, `chat-forward:${randomId()}:${idempotencyKey('f')}`),
    onSuccess: (_result, threadId) => onForwarded(threadId),
    onError: () => setError('Не вдалося переслати повідомлення. Спробуйте ще раз.'),
  })
  const targets = (threads.data?.items ?? []).filter((item) => item.id !== currentThreadId)

  return (
    <Drawer title="Переслати повідомлення" onRequestClose={() => onClose()}>
      <div className="forward-message">
        <section className="forward-message__preview" aria-label="Повідомлення для пересилання">
          <strong>{message.author.displayName}</strong>
          <p>{replyPreviewText(message)}</p>
          {message.attachments.length > 0 && (
            <small>Файли залишаться в початковому повідомленні.</small>
          )}
        </section>
        {threads.isLoading ? <Skeleton rows={5} /> : targets.length === 0 ? (
          <EmptyState
            title="Немає куди переслати"
            description="Спочатку відкрийте або створіть інший діалог."
          />
        ) : (
          <ul className="forward-message__targets">
            {targets.map((thread: ChatThreadListItem) => (
              <li key={thread.id}>
                <button
                  type="button"
                  disabled={forward.isPending}
                  onClick={() => {
                    setError('')
                    forward.mutate(thread.id)
                  }}
                >
                  <Avatar size="sm" name={thread.title} src={thread.avatarAsset ?? null} />
                  <span>
                    <strong>{thread.title}</strong>
                    <small>{thread.lastMessage || 'Без повідомлень'}</small>
                  </span>
                  <Forward size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Drawer>
  )
}

function forwardedBody(message: ChatMessageView): string {
  const attribution = `Переслано від ${message.author.displayName}:`
  const body = message.body.trim()
  if (body) return `${attribution}\n${body}`
  // A message can carry attachments and no text; name them so the forward
  // still says what was shared.
  const names = message.attachments.map((attachment) => attachment.fileName).join(', ')
  return `${attribution}\n${names ? `Файл: ${names}` : '(без тексту)'}`
}
