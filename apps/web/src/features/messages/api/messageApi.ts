import type {
  ChatAttachmentView,
  ChatContactUser,
  ChatMessagePage,
  ChatMessageSearchPage,
  ChatMessageView,
  ChatThreadDetail,
  ChatThreadPage,
  ChatThreadPreview,
  ChatUserSearchPage,
  CreateChatThreadInput,
  RecommendedChatUsersPage,
  SendChatMessageInput,
} from '@bert-crm/contracts'
import { api, idempotencyKey, jsonBody } from '../../../shared/api/client'

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
  const query = new URLSearchParams({ company: companyId, q: queryValue, limit: '20' })
  return api<ChatUserSearchPage>(`/messages/users/search?${query}`, { signal })
}

export function getChatUser(companyId: string, userId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ company: companyId })
  return api<ChatContactUser>(`/messages/users/${encodeURIComponent(userId)}?${query}`, { signal })
}

export function getRecommendedChatUsers(companyId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ company: companyId, limit: '5' })
  return api<RecommendedChatUsersPage>(`/messages/users/recommended?${query}`, { signal })
}

export function createThread(input: CreateChatThreadInput, key = idempotencyKey('chat-thread')) {
  return api<{ id: string; created: boolean }>('/messages/threads', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: jsonBody(input),
  })
}

export function sendMessage(
  threadId: string,
  input: SendChatMessageInput,
  key: string,
) {
  return api<{ id: string }>(`/messages/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: jsonBody(input),
  })
}

export function uploadMessageAttachment(threadId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<ChatAttachmentView>(`/messages/threads/${threadId}/attachments`, {
    method: 'POST',
    body: form,
  })
}
