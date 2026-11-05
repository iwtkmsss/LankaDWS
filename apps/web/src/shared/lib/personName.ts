/** User names are stored as surname, given name, patronymic. Keep the stored
 * value intact and omit the patronymic only when presenting a person. */
export function personPatronymic(displayName: string | null | undefined): string {
  const parts = displayName?.trim().split(/\s+/u) ?? []
  const last = parts.at(-1) ?? ''
  return parts.length >= 3 && /(?:ич|івна|ївна|овна|евна|євна|ична)$/iu.test(last) ? last : ''
}

export function personName(displayName: string): string
export function personName(displayName: string | null | undefined): string | null | undefined
export function personName(displayName: string | null | undefined): string | null | undefined {
  if (displayName == null) return displayName
  const name = displayName
  const patronymic = personPatronymic(name)
  return patronymic ? name.trim().slice(0, -patronymic.length).trimEnd() : name
}

export function conversationName(thread: { kind?: string; title: string }): string {
  return thread.kind === 'DIRECT' ? personName(thread.title) : thread.title
}

/** For generated notification and audience labels, never for authored bodies. */
export function personNamesInLabel(label: string): string {
  return label.replace(/([\p{Lu}][\p{L}’'ʼ-]+(?:\s+[\p{Lu}][\p{L}’'ʼ-]+)+)\s+([\p{Lu}][\p{L}’'ʼ-]*(?:ич|івна|ївна|овна|евна|євна|ична))(?=$|[^\p{L}])/gu, '$1')
}
