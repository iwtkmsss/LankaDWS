type MessageIdentity = {
  authorId: string
  createdAt: string
  deletedAt?: string | null
}

/** Pass the preceding message in chronological order, regardless of list direction. */
export function continuesMessageGroup(current: MessageIdentity, previous?: MessageIdentity): boolean {
  if (!previous || current.deletedAt || previous.deletedAt || current.authorId !== previous.authorId) return false
  const currentDate = new Date(current.createdAt)
  const previousDate = new Date(previous.createdAt)
  return currentDate.getFullYear() === previousDate.getFullYear()
    && currentDate.getMonth() === previousDate.getMonth()
    && currentDate.getDate() === previousDate.getDate()
}
