import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { taskListSortExpressions, taskListSortQuery } from './task-list-sort.js'

describe('task list sorting', () => {
  it('sorts the authorized dataset before pagination and keeps null deadlines last', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE Task (id TEXT, title TEXT, dueAt INTEGER, priority TEXT)')
      const insert = db.prepare('INSERT INTO Task VALUES (?, ?, ?, ?)')
      insert.run('a', 'Zulu', null, 'LOW')
      insert.run('b', 'Beta', 20, 'URGENT')
      insert.run('c', 'Alpha', 10, 'MEDIUM')
      insert.run('private', 'A secret', 1, 'HIGH')
      const run = (sort: 'title' | 'dueDate' | 'priority', direction: 'asc' | 'desc', page = 1, size = 2) => {
        const query = taskListSortQuery(['a', 'b', 'c'], sort, direction, page, size)
        return (db.prepare(query.sql).all(...query.values) as Array<{ id: string }>).map((row) => row.id)
      }
      expect(run('title', 'asc')).toEqual(['c', 'b'])
      expect(run('title', 'asc', 2)).toEqual(['a'])
      expect(run('title', 'desc')).toEqual(['a', 'b'])
      expect(run('dueDate', 'desc', 1, 3)).toEqual(['b', 'c', 'a'])
      expect(run('priority', 'asc', 1, 3)).toEqual(['a', 'c', 'b'])
    } finally {
      db.close()
    }
  })
  it('sorts people, statuses, subtasks and activity using the displayed active records', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE Task (id TEXT, title TEXT, dueAt INTEGER, priority TEXT, status TEXT, reporterId TEXT, parentTaskId TEXT, archivedAt INTEGER);
        CREATE TABLE User (id TEXT, displayName TEXT);
        CREATE TABLE TaskParticipant (id TEXT, taskId TEXT, userId TEXT, role TEXT, removedAt INTEGER, createdAt INTEGER);
        CREATE TABLE Comment (entityType TEXT, entityId TEXT, deletedAt INTEGER);
        CREATE TABLE FileLink (entityType TEXT, entityId TEXT, purpose TEXT);
        INSERT INTO User VALUES ('anna', 'Anna'), ('zoya', 'Zoya');
        INSERT INTO Task VALUES ('a', 'A', 10, 'LOW', 'DONE', 'zoya', NULL, NULL), ('b', 'B', 20, 'HIGH', 'NEW', 'anna', NULL, NULL);
        INSERT INTO Task VALUES ('child', 'Child', NULL, 'LOW', 'NEW', 'anna', 'a', NULL);
        INSERT INTO TaskParticipant VALUES ('p1', 'a', 'anna', 'RESPONSIBLE', NULL, 1), ('p2', 'b', 'zoya', 'RESPONSIBLE', NULL, 1);
        INSERT INTO TaskParticipant VALUES ('removed', 'b', 'anna', 'RESPONSIBLE', 1, 0);
        INSERT INTO Comment VALUES ('TASK', 'a', NULL), ('TASK', 'b', 1);
        INSERT INTO FileLink VALUES ('TASK', 'a', 'ATTACHMENT');
      `)
      const run = (sort: keyof typeof taskListSortExpressions) => {
        const query = taskListSortQuery(['a', 'b'], sort, 'asc', 1, 25)
        return (db.prepare(query.sql).all(...query.values) as Array<{ id: string }>).map((row) => row.id)
      }
      expect(run('reporter')).toEqual(['b', 'a'])
      expect(run('responsibles')).toEqual(['a', 'b'])
      expect(run('status')).toEqual(['b', 'a'])
      expect(run('subtaskProgress')).toEqual(['b', 'a'])
      expect(run('activity')).toEqual(['b', 'a'])
    } finally {
      db.close()
    }
  })
})
