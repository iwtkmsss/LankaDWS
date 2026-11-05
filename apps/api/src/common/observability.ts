import type { NextFunction, Response } from 'express'
import type { LankaDWSRequest } from './request-context.js'

const MAX_LATENCY_SAMPLES = 2_000
const latencies: number[] = []
let requestCount = 0
let errorCount = 0
const startedAt = Date.now()

function percentile(values: number[], point: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * point))] ?? 0
}

function safeRoute(request: LankaDWSRequest): string {
  return (request.path || '/')
    .replace(/\/[a-z]{2,8}_[a-zA-Z0-9_-]{4,}/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
}

export function requestObservability(request: LankaDWSRequest, response: Response, next: NextFunction): void {
  const started = process.hrtime.bigint()
  response.once('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000
    requestCount += 1
    if (response.statusCode >= 500) errorCount += 1
    latencies.push(latencyMs)
    if (latencies.length > MAX_LATENCY_SAMPLES) latencies.splice(0, latencies.length - MAX_LATENCY_SAMPLES)

    process.stdout.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
      service: 'lankadws-api',
      buildVersion: process.env.BUILD_VERSION ?? 'development',
      method: request.method,
      route: safeRoute(request),
      status: response.statusCode,
      latencyMs: Math.round(latencyMs * 10) / 10,
      correlationId: request.correlationId,
      ...(request.principal ? {
        principalId: request.principal.userId,
        workspaceId: request.principal.workspaceId,
        companyId: request.principal.primaryCompanyId,
      } : {}),
    })}\n`)
  })
  next()
}

export function requestMetrics() {
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
    requests: { total: requestCount, errors: errorCount },
    latencyMs: {
      p50: Math.round(percentile(latencies, 0.5) * 10) / 10,
      p75: Math.round(percentile(latencies, 0.75) * 10) / 10,
      p95: Math.round(percentile(latencies, 0.95) * 10) / 10,
      samples: latencies.length,
    },
    memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed },
  }
}
