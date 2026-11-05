import { Prisma } from '../../generated/prisma/client.js'

// Expressions are fixed server-side; request values never become SQL identifiers.
export const taskListSortExpressions = {
  title: 't.title COLLATE NOCASE',
  reporter: '(SELECT displayName FROM User WHERE id = t.reporterId) COLLATE NOCASE',
  responsibles: `(SELECT u.displayName FROM TaskParticipant p JOIN User u ON u.id = p.userId
    WHERE p.taskId = t.id AND p.role = 'RESPONSIBLE' AND p.removedAt IS NULL
    ORDER BY p.createdAt, p.id LIMIT 1) COLLATE NOCASE`,
  dueDate: 't.dueAt',
  status: "CASE t.status WHEN 'NEW' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'IN_REVIEW' THEN 2 WHEN 'DONE' THEN 3 ELSE 4 END",
  priority: "CASE t.priority WHEN 'LOW' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END",
  subtaskProgress: '(SELECT COUNT(*) FROM Task s WHERE s.parentTaskId = t.id AND s.archivedAt IS NULL)',
  activity: `(SELECT COUNT(*) FROM Comment c WHERE c.entityType = 'TASK' AND c.entityId = t.id AND c.deletedAt IS NULL)
    + (SELECT COUNT(*) FROM FileLink f WHERE f.entityType = 'TASK' AND f.entityId = t.id AND f.purpose = 'ATTACHMENT')`,
} as const

export function taskListSortQuery(ids: string[], sort: keyof typeof taskListSortExpressions, direction: 'asc' | 'desc', page: number, pageSize: number) {
  const expression = Prisma.raw(taskListSortExpressions[sort])
  return Prisma.sql`SELECT t.id FROM Task t
    WHERE t.id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
    ORDER BY (${expression}) IS NULL, ${expression} ${Prisma.raw(direction)}, t.id ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
}
