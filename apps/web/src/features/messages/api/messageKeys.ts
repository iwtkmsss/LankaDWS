export const messageKeys = {
  all: ['messages'] as const,
  threads: (companyId: string, unread: boolean) =>
    [...messageKeys.all, 'threads', companyId, unread] as const,
  detail: (threadId: string) =>
    [...messageKeys.all, 'thread', threadId] as const,
  pages: (threadId: string) =>
    [...messageKeys.detail(threadId), 'pages'] as const,
  search: (threadId: string, query: string) =>
    [...messageKeys.detail(threadId), 'search', query] as const,
  users: (companyId: string, query: string) =>
    [...messageKeys.all, 'users', companyId, query] as const,
  recommended: (companyId: string) =>
    [...messageKeys.all, 'recommended', companyId] as const,
}
