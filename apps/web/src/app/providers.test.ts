import { describe, expect, it } from 'vitest'
import { ApiProblem } from '../shared/api/client'
import { shouldRetryQuery } from './providers'

function problem(status: number): ApiProblem {
  return new ApiProblem({
    type: 'about:blank',
    title: 'Request failed',
    status,
    code: `http_${status}`,
    correlationId: 'test',
  })
}

describe('query retry policy', () => {
  it('does not retry deterministic client errors', () => {
    expect(shouldRetryQuery(0, problem(400))).toBe(false)
    expect(shouldRetryQuery(0, problem(403))).toBe(false)
    expect(shouldRetryQuery(0, problem(404))).toBe(false)
  })

  it('keeps one retry for transient and server failures', () => {
    expect(shouldRetryQuery(0, problem(500))).toBe(true)
    expect(shouldRetryQuery(1, problem(500))).toBe(false)
    expect(shouldRetryQuery(0, new TypeError('network failed'))).toBe(true)
    expect(shouldRetryQuery(1, new TypeError('network failed'))).toBe(false)
  })
})
