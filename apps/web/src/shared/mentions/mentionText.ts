import type { StructuredMentionInput, StructuredMentionView } from '@bert-crm/contracts'

export function reconcileMentionChange(
  previousValue: string,
  nextValue: string,
  mentions: StructuredMentionInput[],
): StructuredMentionInput[] {
  let prefix = 0
  while (
    prefix < previousValue.length
    && prefix < nextValue.length
    && previousValue[prefix] === nextValue[prefix]
  ) prefix += 1

  let suffix = 0
  while (
    suffix < previousValue.length - prefix
    && suffix < nextValue.length - prefix
    && previousValue[previousValue.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
  ) suffix += 1

  const previousEditEnd = previousValue.length - suffix
  const nextEditEnd = nextValue.length - suffix
  const delta = nextEditEnd - previousEditEnd
  return mentions.flatMap((mention) => {
    if (mention.end <= prefix) return [mention]
    if (mention.start >= previousEditEnd) {
      return [{ ...mention, start: mention.start + delta, end: mention.end + delta }]
    }
    return []
  })
}

export function trimMentionValue(
  value: string,
  mentions: StructuredMentionInput[],
): { body: string; mentions: StructuredMentionInput[] } {
  const start = value.length - value.trimStart().length
  const end = value.trimEnd().length
  return {
    body: value.slice(start, end),
    mentions: mentions.flatMap((mention) =>
      mention.start >= start && mention.end <= end
        ? [{ ...mention, start: mention.start - start, end: mention.end - start }]
        : []),
  }
}

export function editableMentions(
  body: string,
  mentions: StructuredMentionView[],
): StructuredMentionInput[] {
  return mentions.flatMap((mention) => {
    const text = body.slice(mention.start, mention.end)
    return text.startsWith('@') && text.length > 1
      ? [{ ...mention, label: text.slice(1) }]
      : []
  })
}
