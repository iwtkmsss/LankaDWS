import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<{ correlationId: string }>()

/** Runs `callback` with the given correlation ID visible to everything it (asynchronously) calls. */
export function runWithCorrelationId<T>(correlationId: string, callback: () => T): T {
  return storage.run({ correlationId }, callback)
}

/** The correlation ID of the current HTTP request, or undefined outside a request (jobs, CLI). */
export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId
}
