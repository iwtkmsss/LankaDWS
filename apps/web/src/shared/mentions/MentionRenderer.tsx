import type { ReactNode } from 'react'
import type { StructuredMentionView } from '@lankadws/contracts'
import { UserProfileLink } from '../../features/employees/UserProfileDrawer'
import { personName } from '../lib/personName'

export function MentionText({ body, mentions, hideMentionPrefix = false }: { body: string; mentions: StructuredMentionView[]; hideMentionPrefix?: boolean }) {
  const ordered = mentions
    .filter((mention) => mention.start >= 0 && mention.end <= body.length && mention.end > mention.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
  const content: ReactNode[] = []
  let cursor = 0
  for (const mention of ordered) {
    if (mention.start < cursor) continue
    if (mention.start > cursor) content.push(body.slice(cursor, mention.start))
    const label = body.slice(mention.start, mention.end)
    const text = personName(hideMentionPrefix ? label.replace(/^@/, '') : label)
    content.push(mention.active
      ? (
          <UserProfileLink className="structured-mention" userId={mention.userId} key={`${mention.start}:${mention.userId}`}>
            {text}
          </UserProfileLink>
        )
      : <span className="structured-mention is-inactive" key={`${mention.start}:${mention.userId}`}>{text}</span>)
    cursor = mention.end
  }
  if (cursor < body.length) content.push(body.slice(cursor))
  return <>{content}</>
}
