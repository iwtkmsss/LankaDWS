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

export function apiUrl(path: string): string { return `${baseUrl}${path}` }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json')
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && csrfToken) headers.set('x-csrf-token', csrfToken)
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ type: 'about:blank', title: 'Не вдалося виконати запит', status: response.status, code: `http_${response.status}`, correlationId: response.headers.get('x-correlation-id') ?? 'unknown' })) as ProblemDetails
    if (response.status === 401 && !path.startsWith('/auth/') && body.code !== 'credential_step_required') {
      window.dispatchEvent(new Event('bert:session-ended'))
    }
    throw new ApiProblem(body)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function jsonBody(value: unknown): string { return JSON.stringify(value) }

export function randomId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure random values are unavailable in this browser')
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

export function idempotencyKey(prefix: string): string { return `${prefix}:${randomId()}` }
