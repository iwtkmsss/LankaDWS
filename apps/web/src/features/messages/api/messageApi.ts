import { searchUsers } from '../../../shared/api/user-search'
import { USER_SEARCH_LIMIT } from '@lankadws/contracts'
import type {
  ChatAttachmentView,
  ChatContactUser,
  ChatMessagePage,
  ChatMessageSearchPage,
  ChatMessageView,
  ChatThreadDetail,
  ChatThreadPage,
  ChatThreadPreview,
  CreateChatThreadInput,
  RecommendedChatUsersPage,
  SendChatMessageInput,
} from '@lankadws/contracts'
import { api, idempotencyKey, jsonBody } from '../../../shared/api/client'
import { photoAttachmentBatches } from '../lib/photoAlbums'

export function getThreadPage(
  companyId: string,
  unread: boolean,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ChatThreadPage> {
  const query = new URLSearchParams({ company: companyId, limit: '30' })
  if (unread) query.set('unread', 'true')
  if (cursor) query.set('cursor', cursor)
  return api(`/messages/threads?${query}`, { signal })
}

export function getThreadDetail(threadId: string, signal?: AbortSignal) {
  return api<ChatThreadDetail>(`/messages/threads/${threadId}`, { signal })
}

export function getMessagePage(
  threadId: string,
  options: { before?: string; after?: string; around?: string } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: '50' })
  if (options.before) query.set('before', options.before)
  if (options.after) query.set('after', options.after)
  if (options.around) query.set('around', options.around)
  return api<ChatMessagePage>(`/messages/threads/${threadId}/messages?${query}`, { signal })
}

export function searchThreadMessages(
  threadId: string,
  queryValue: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ q: queryValue, limit: '20' })
  if (cursor) query.set('cursor', cursor)
  return api<ChatMessageSearchPage>(
    `/messages/threads/${threadId}/messages/search?${query}`,
    { signal },
  )
}

export function getMessage(messageId: string, signal?: AbortSignal) {
  return api<ChatMessageView>(`/messages/${messageId}`, { signal })
}

export function getThreadPreview(threadId: string, signal?: AbortSignal) {
  return api<ChatThreadPreview>(`/messages/threads/${threadId}/preview`, { signal })
}

export function searchChatUsers(
  companyId: string,
  queryValue: string,
  signal?: AbortSignal,
) {
  return searchUsers<ChatContactUser>(queryValue, { endpoint: '/messages/users/search', params: { company: companyId }, signal })
}

export function getChatUser(companyId: string, userId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ company: companyId })
  return api<ChatContactUser>(`/messages/users/${encodeURIComponent(userId)}?${query}`, { signal })
}

export function getRecommendedChatUsers(companyId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ company: companyId, limit: String(USER_SEARCH_LIMIT) })
  return api<RecommendedChatUsersPage>(`/messages/users/recommended?${query}`, { signal })
}

export function createThread(input: CreateChatThreadInput, key = idempotencyKey('chat-thread')) {
  return api<{ id: string; created: boolean }>('/messages/threads', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: jsonBody(input),
  })
}

export async function sendMessage(
  threadId: string,
  input: SendChatMessageInput,
  key: string,
  attachments?: Pick<ChatAttachmentView, 'id' | 'mimeType'>[],
) {
  const batches = attachments ? photoAttachmentBatches(attachments) : null
  let result!: { id: string }
  for (let index = 0; index < (batches?.length ?? 1); index++) {
    result = await api<{ id: string }>(`/messages/threads/${threadId}/messages`, {
      method: 'POST',
      // Stable keys let a retry finish a partially sent album without duplicates.
      headers: { 'idempotency-key': index === 0 ? key : `${key}:album:${index}` },
      body: jsonBody({
        ...input,
        ...(batches ? { attachmentIds: batches[index]!.map((attachment) => attachment.id) } : {}),
        ...(index > 0 ? { body: '', mentions: [] } : {}),
      }),
    })
  }
  return result
}

export function uploadMessageAttachment(threadId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<ChatAttachmentView>(`/messages/threads/${threadId}/attachments`, {
    method: 'POST',
    body: form,
  })
}

export function setMessageReaction(messageId: string, liked: boolean) {
  return api<ChatMessageView>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: liked ? 'POST' : 'DELETE',
    body: jsonBody({ kind: 'LIKE' }),
  })
}

export async function uploadMessageAttachments(threadId: string, files: File[]) {
  const uploaded: ChatAttachmentView[] = []
  let failed = 0
  let next = 0
  async function worker(): Promise<void> {
    while (next < files.length) {
      const index = next++
      try {
        uploaded[index] = await uploadMessageAttachment(threadId, files[index]!)
      } catch {
        failed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()))
  return { uploaded: uploaded.filter(Boolean), failed }
}
