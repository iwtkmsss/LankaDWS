import { z } from 'zod'
import { DomainError } from './errors.js'

/** Parses an untrusted request body; failures become the standard 400 `validation_failed` with field errors. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new DomainError(400, 'validation_failed', 'Перевірте виділені поля.', z.flattenError(parsed.error).fieldErrors as Record<string, string[]>)
  return parsed.data
}

/** Optimistic-concurrency body shared by publish/archive/restore/acknowledge-style commands. */
export const expectedVersionBodySchema = z.object({ expectedVersion: z.number().int() })
