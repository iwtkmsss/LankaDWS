import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'
import { ProblemCode, type ProblemDetails } from '@bert-crm/contracts'

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly safeDetail?: string,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly safeExtensions?: Pick<ProblemDetails, 'blockingSubtaskIds'>,
  ) {
    super(code)
  }
}

export const badRequest = (code: string = ProblemCode.ValidationFailed, detail?: string) => new DomainError(400, code, detail)
export const unauthorized = (code: string = ProblemCode.AuthenticationRequired) => new DomainError(401, code)
export const forbidden = (detail?: string) => new DomainError(403, ProblemCode.Forbidden, detail)
export const capabilityDisabled = (detail: string = 'Цей модуль ще не ввімкнено для організації.') => new DomainError(403, ProblemCode.CapabilityDisabled, detail)
export const notFound = () => new DomainError(404, ProblemCode.NotFound)
export const conflict = (detail?: string) => new DomainError(409, ProblemCode.Conflict, detail)
export const taskCompletionBlocked = (blockingSubtaskIds: string[]) => new DomainError(
  409,
  ProblemCode.TaskCompletionBlocked,
  'Спочатку завершіть або скасуйте активні підзадачі.',
  undefined,
  { blockingSubtaskIds },
)
export const rateLimited = () => new DomainError(429, ProblemCode.RateLimited)
export const unavailable = (detail?: string) => new DomainError(503, ProblemCode.ServiceUnavailable, detail)

const titles: Record<number, string> = {
  400: 'Некоректний запит',
  401: 'Потрібна автентифікація',
  403: 'Доступ заборонено',
  404: 'Об’єкт не знайдено',
  409: 'Конфлікт версій',
  410: 'Ресурс більше не доступний',
  429: 'Забагато запитів',
  500: 'Внутрішня помилка',
  503: 'Сервіс тимчасово недоступний',
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<Request & { correlationId?: string }>()
    const response = http.getResponse<Response>()
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR
    let code: string = ProblemCode.InternalError
    let detail: string | undefined
    let errors: Record<string, string[]> | undefined

    if (exception instanceof DomainError) {
      status = exception.status
      code = exception.code
      detail = exception.safeDetail
      errors = exception.fieldErrors
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      code = status === 400 ? ProblemCode.ValidationFailed : `http_${status}`
      const body = exception.getResponse()
      detail = typeof body === 'string' ? body : undefined
    } else {
      process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(), level: 'error', service: 'bert-crm-api',
        correlationId: request.correlationId, errorClass: exception instanceof Error ? exception.name : 'UnknownError',
      })}\n`)
    }

    const problem: ProblemDetails = {
      type: `https://bert-crm.local/problems/${code}`,
      title: titles[status] ?? 'Помилка',
      status,
      code,
      correlationId: request.correlationId ?? 'unknown',
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
      ...(exception instanceof DomainError ? exception.safeExtensions : {}),
    }
    response.status(status).type('application/problem+json').json(problem)
  }
}
