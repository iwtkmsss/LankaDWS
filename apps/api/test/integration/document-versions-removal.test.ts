import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrations = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url))
const removal = '20261012120000_remove_document_versions'

describe('document version removal migration', () => {
  it('preserves latest files, empty documents and other file links, while removing history', () => {
    const db = new Database(':memory:')
    try {
      for (const name of readdirSync(migrations).filter((name) => name < removal).sort()) {
        db.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
      }
      db.exec(`
        INSERT INTO Document (id, workspaceId, companyId, number, name, ownerId, status, currentVersionId, version, updatedAt)
          VALUES ('doc', 'ws', 'cmp', 'DOC-1', 'File', 'usr', 'PUBLISHED', 'old-version', 8, 1),
                 ('empty', 'ws', 'cmp', 'DOC-2', 'Empty', 'usr', 'DRAFT', NULL, 1, 1);
        INSERT INTO DocumentVersion (id, documentId, version, fileId, createdBy, changeSummary, status)
          VALUES ('old-version', 'doc', 1, 'old-file', 'usr', 'Old', 'PUBLISHED'),
                 ('new-version', 'doc', 2, 'current-file', 'usr', 'Latest', 'PUBLISHED'),
                 ('latest-version', 'doc', 3, 'current-file', 'usr', 'Latest again', 'PUBLISHED');
        INSERT INTO FileLink (id, fileId, entityType, entityId, purpose, aclMode)
          VALUES ('old-link', 'old-file', 'DOCUMENT', 'doc', 'VERSION', 'INHERIT'),
                 ('new-link', 'current-file', 'DOCUMENT', 'doc', 'VERSION_2', 'INHERIT'),
                 ('duplicate-link', 'current-file', 'DOCUMENT', 'doc', 'VERSION_3', 'INHERIT'),
                 ('chat-link', 'old-file', 'MESSAGE', 'msg', 'ATTACHMENT', 'INHERIT');
        INSERT INTO FileObject (id, workspaceId, companyId, storageKey, safeFilename, declaredMime, bytes, sha256, ownerId, updatedAt)
          VALUES ('old-file', 'ws', 'cmp', 'old-file', 'old.txt', 'text/plain', 10, 'old', 'usr', 1),
                 ('current-file', 'ws', 'cmp', 'current-file', 'new.txt', 'text/plain', 20, 'new', 'usr', 1);
      `)
      db.exec(readFileSync(join(migrations, removal, 'migration.sql'), 'utf8'))
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.prepare('SELECT id, fileId, status, version FROM Document ORDER BY id').all()).toEqual([
        { id: 'doc', fileId: 'current-file', status: 'PUBLISHED', version: 8 },
        { id: 'empty', fileId: null, status: 'DRAFT', version: 1 },
      ])
      expect(db.prepare("SELECT fileId, purpose FROM FileLink WHERE entityType = 'DOCUMENT'").all())
        .toEqual([{ fileId: 'current-file', purpose: 'CONTENT' }])
      expect(db.prepare("SELECT fileId, purpose FROM FileLink WHERE entityType = 'MESSAGE'").all())
        .toEqual([{ fileId: 'old-file', purpose: 'ATTACHMENT' }])
      expect(db.prepare('SELECT COUNT(*) AS count FROM FileObject').get()).toEqual({ count: 2 })
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'DocumentVersion'").all()).toEqual([])
      expect((db.pragma('table_info(Document)') as Array<{ name: string }>).map((column) => column.name))
        .not.toContain('currentVersionId')
      expect((db.pragma('table_info(ImportBinaryTransfer)') as Array<{ name: string }>).map((column) => column.name))
        .not.toContain('documentVersionId')
    } finally {
      db.close()
    }
  })
})
