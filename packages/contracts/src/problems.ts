export interface ProblemDetails {
  type: string
  title: string
  status: number
  code: string
  detail?: string
  correlationId: string
  errors?: Record<string, string[]>
}

export const ProblemCode = {
  ValidationFailed: 'validation_failed',
  AuthenticationRequired: 'authentication_required',
  InvalidCredentials: 'invalid_credentials',
  TwoFactorRequired: 'two_factor_required',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'version_conflict',
  RateLimited: 'rate_limited',
  FileQuarantined: 'file_quarantined',
  ServiceUnavailable: 'service_unavailable',
  InternalError: 'internal_error',
} as const
