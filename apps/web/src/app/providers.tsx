import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../shared/auth/AuthProvider'
import { ApiProblem } from '../shared/api/client'

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiProblem && error.problem.status >= 400 && error.problem.status < 500) return false
  return failureCount < 1
}

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetryQuery, refetchOnWindowFocus: false }, mutations: { retry: 0 } } })

export function AppProviders({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>
}
