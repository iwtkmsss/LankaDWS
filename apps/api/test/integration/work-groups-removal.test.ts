import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrations = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url))
const removal = '20261008120000_remove_work_groups'

describe('work-group removal migration', () => {
  it('removes group content and grants while preserving tasks, files, chat history and user state', () => {
    const db = new Database(':memory:')
    try {
      for (const name of readdirSync(migrations).filter((name) => name < removal).sort()) {
        db.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
      }
      db.exec(`
        INSERT INTO Workspace (id, displayName, updatedAt) VALUES ('ws', 'Workspace', 1);
        INSERT INTO Company (id, workspaceId, displayName, legalName, code, updatedAt)
          VALUES ('cmp', 'ws', 'Company', 'Company', 'test', 1);
        INSERT INTO User (id, workspaceId, primaryCompanyId, displayName, normalizedDisplayName,
          username, normalizedUsername, updatedAt) VALUES ('usr', 'ws', 'cmp', 'User', 'user', 'user', 'user', 1);
        INSERT INTO "Group" (id, workspaceId, companyId, key, name, ownerId, updatedAt)
          VALUES ('grp', 'ws', 'cmp', 'retired', 'Retired group', 'usr', 1);
        INSERT INTO GroupMember (id, groupId, userId, role) VALUES ('member', 'grp', 'usr', 'OWNER');
        INSERT INTO FeedPost (id, workspaceId, companyId, groupId, authorId, body, publishedAt, updatedAt)
          VALUES ('post', 'ws', 'cmp', 'grp', 'usr', 'Private group post', 1, 1);
        INSERT INTO FeedPostRecipient (id, postId, type, recipientId) VALUES ('recipient', 'post', 'GROUP', 'grp');
        INSERT INTO FeedSubscription (id, postId, userId, updatedAt) VALUES ('subscription', 'post', 'usr', 1);
        INSERT INTO Comment (id, workspaceId, companyId, entityType, entityId, authorId, body, visibility)
          VALUES ('comment', 'ws', 'cmp', 'FEED_POST', 'post', 'usr', 'Comment', 'FEED_AUDIENCE');
        INSERT INTO FeedItem (id, workspaceId, companyId, postId, sourceType, sourceId, sourceVersion,
          action, eventKey, visibility, safePayload, occurredAt)
          VALUES ('item', 'ws', 'cmp', 'post', 'POST', 'post', 1, 'PUBLISHED', 'test-post', 'GROUP', '{}', 1);
        INSERT INTO FeedItemRecipient (id, itemId, userId) VALUES ('item-recipient', 'item', 'usr');
        INSERT INTO FeedReadCursor (id, userId, companyId, lastReadOccurredAt, lastReadItemId, updatedAt)
          VALUES ('cursor', 'usr', 'cmp', 1, 'item', 1);
        INSERT INTO MessageThread (id, workspaceId, companyId, kind, title, entityType, entityId)
          VALUES ('context-chat', 'ws', 'cmp', 'CONTEXTUAL', 'Former work-group chat', 'GROUP', 'grp');
        INSERT INTO MessageThread (id, workspaceId, companyId, kind, title)
          VALUES ('chat', 'ws', 'cmp', 'GROUP', 'Independent group chat');
        INSERT INTO ThreadParticipant (id, threadId, userId, role) VALUES ('participant', 'context-chat', 'usr', 'OWNER');
        INSERT INTO Message (id, threadId, authorId, body) VALUES ('message', 'context-chat', 'usr', 'Preserved message');
        INSERT INTO Task (id, workspaceId, companyId, groupId, number, title, createdById, reporterId, updatedAt)
          VALUES ('task', 'ws', 'cmp', 'grp', '1', 'Preserved task', 'usr', 'usr', 1);
        INSERT INTO FileObject (id, workspaceId, companyId, storageKey, safeFilename, declaredMime,
          bytes, sha256, ownerId, updatedAt) VALUES ('file', 'ws', 'cmp', 'file', 'file.txt', 'text/plain', 1, 'sha', 'usr', 1);
        INSERT INTO DriveShare (id, workspaceId, targetType, targetId, principalType, principalId, role, createdBy)
          VALUES ('group-grant', 'ws', 'DOCUMENT', 'doc', 'GROUP', 'grp', 'VIEWER', 'usr');
        INSERT INTO DriveShare (id, workspaceId, targetType, targetId, principalType, principalId, role, createdBy)
          VALUES ('user-grant', 'ws', 'DOCUMENT', 'doc', 'USER', 'usr', 'VIEWER', 'usr');
        INSERT INTO SavedView (id, userId, module, name, queryState, updatedAt)
          VALUES ('view', 'usr', 'TASKS', 'View', '{"groupId":"grp","status":"NEW"}', 1);
        INSERT INTO UserUiPreference (id, userId, module, key, schemaVersion, valueJson, updatedAt)
          VALUES ('preference', 'usr', 'TASKS', 'LIST_COLUMNS', 1, '{"visible":["reporter","group","status"]}', 1);
      `)

      db.exec(readFileSync(join(migrations, removal, 'migration.sql'), 'utf8'))

      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('Group', 'GroupMember', 'GroupJoinRequest')").all()).toEqual([])
      for (const table of ['FeedPost', 'FeedPostRecipient', 'FeedSubscription', 'Comment', 'FeedItem', 'FeedItemRecipient']) {
        expect(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()).toEqual({ count: 0 })
      }
      expect(db.prepare('SELECT id, title FROM Task').all()).toEqual([{ id: 'task', title: 'Preserved task' }])
      expect(db.prepare('SELECT id FROM FileObject').all()).toEqual([{ id: 'file' }])
      expect(db.prepare('SELECT id, body FROM Message').all()).toEqual([{ id: 'message', body: 'Preserved message' }])
      expect(db.prepare('SELECT id FROM ThreadParticipant').all()).toEqual([{ id: 'participant' }])
      expect(db.prepare("SELECT kind, entityType, entityId FROM MessageThread WHERE id = 'context-chat'").get())
        .toEqual({ kind: 'GROUP', entityType: null, entityId: null })
      expect(db.prepare("SELECT kind, title FROM MessageThread WHERE id = 'chat'").get())
        .toEqual({ kind: 'GROUP', title: 'Independent group chat' })
      expect(db.prepare('SELECT id FROM DriveShare').all()).toEqual([{ id: 'user-grant' }])
      expect(db.prepare('SELECT queryState FROM SavedView').get()).toEqual({ queryState: '{"status":"NEW"}' })
      expect(db.prepare('SELECT valueJson FROM UserUiPreference').get()).toEqual({ valueJson: '{"visible":["reporter","status"]}' })
      expect(db.prepare('SELECT lastReadOccurredAt, lastReadItemId FROM FeedReadCursor').get())
        .toEqual({ lastReadOccurredAt: 1, lastReadItemId: 'item' })
      const taskColumns = db.pragma('table_info(Task)') as Array<{ name: string }>
      expect(taskColumns.map((column) => column.name)).not.toContain('groupId')
    } finally {
      db.close()
    }
  })
})
