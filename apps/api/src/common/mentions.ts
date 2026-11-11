import type { StructuredMentionInput } from '@lankadws/contracts'
import { badRequest } from './errors.js'

/**
 * Checks that every structured mention points at its own `@label` in the body and that mentions
 * do not overlap. Returns the mentioned user IDs, each once. `errorCode` names the module's
 * validation error (`chat_mention_invalid`, `feed_mention_invalid`, `task_mention_invalid`).
 */
export function validateStructuredMentions(body: string, mentions: StructuredMentionInput[], errorCode: string): string[] {
  const ordered = mentions.toSorted((left, right) => left.start - right.start || left.end - right.end)
  let previousEnd = 0
  for (const mention of ordered) {
    if (
      mention.start < previousEnd
      || mention.end > body.length
      || body.slice(mention.start, mention.end) !== `@${mention.label}`
    ) {
      throw badRequest(errorCode)
    }
    previousEnd = mention.end
  }
  return [...new Set(ordered.map((mention) => mention.userId))]
}
