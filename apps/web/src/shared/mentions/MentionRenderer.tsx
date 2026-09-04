import type { ReactNode } from 'react'
import type { StructuredMentionView } from '@bert-crm/contracts'
import { UserProfileLink } from '../../features/employees/UserProfileDrawer'

export function MentionText({ body, mentions }: { body: string; mentions: StructuredMentionView[] }) {
  const ordered = mentions
    .filter((mention) => mention.start >= 0 && mention.end <= body.length && mention.end > mention.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
  const content: ReactNode[] = []
  let cursor = 0
  for (const mention of ordered) {
    if (mention.start < cursor) continue
    if (mention.start > cursor) content.push(body.slice(cursor, mention.start))
    const text = body.slice(mention.start, mention.end)
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
