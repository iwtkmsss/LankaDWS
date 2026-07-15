import type { ProblemDetails } from '@bert-crm/contracts'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
let csrfToken = ''

export class ApiProblem extends Error {
  readonly problem: ProblemDetails

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title)
    this.problem = problem
  }
}

export function setCsrfToken(value: string): void { csrfToken = value }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json')
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && csrfToken) headers.set('x-csrf-token', csrfToken)
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ type: 'about:blank', title: 'Не вдалося виконати запит', status: response.status, code: `http_${response.status}`, correlationId: response.headers.get('x-correlation-id') ?? 'unknown' })) as ProblemDetails
    throw new ApiProblem(body)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function jsonBody(value: unknown): string { return JSON.stringify(value) }

export function idempotencyKey(prefix: string): string { return `${prefix}:${crypto.randomUUID()}` }
