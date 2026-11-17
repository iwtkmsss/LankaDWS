// Load step of the one-off Bitrix24 import (docs/migration/bitrix24/import-script.md): reads the NDJSON
// files written by extract.ts and writes LankaDWS rows straight into a fresh SQLite database.
// It writes no notifications, outbox events, realtime signals or unread counters: history is silent.
//
//   DATABASE_URL=file:<path> npm run bitrix:load --workspace @lankadws/api -- --in <ndjson dir>
//   npm run bitrix:load --workspace @lankadws/api -- --in <ndjson dir> --db <path> [--reset-imported] [--report <file>]
//
// The DB must already be migrated and hold exactly one Workspace (created by admin:create).
// SESSION_PEPPER comes from the repository .env (or the environment) so DIRECT thread keys match the app.
const explicitDatabaseUrl = process.env.DATABASE_URL

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { normalizeUserSearchValue } from '@lankadws/contracts'
import { convertBitrixText, decodeHtmlEntities, escapeMarkdown, FILE_MARKER_TEXT, rewriteBitrixHref, type MentionTarget } from './bbcode.js'
import { convertRrule, eventTimes } from './calendar.js'
import {
  COMPANY_ID, Stats, formatDuration, ids, isoForSqlite, mskToIso, ndjsonPath, parseArgs, readNdjson, stringOption,
} from './common.js'
import { allocateUsername } from './usernames.js'

type Db = InstanceType<typeof Database>
type Fingerprint = (value: string, purpose: string) => string

const BATCH_SIZE = 10_000
const EMPTY_MESSAGE = '(порожнє повідомлення)'
const EMPTY_COMMENT = '(порожній коментар)'
const EMPTY_POST = '(порожній допис)'
const UNTITLED = 'Без назви'

// ---------------------------------------------------------------- NDJSON row shapes

interface UserRow { id: number; login: string | null; active: string | null; name: string | null; lastName: string | null; secondName: string | null; gender: string | null; birthday: string | null; mobile: string | null; phone: string | null; workPhone: string | null; position: string | null; external: string | null; registeredAt: string | null; updatedAt: string | null; referenced: number }
interface DepartmentRow { id: number; parentId: number | null; name: string | null; sort: number | null; depth: number; active: string | null; headId: number | null; createdAt: string | null; updatedAt: string | null }
interface UserDepartmentRow { userId: number; deptId: number }
interface GroupRow { id: number; name: string | null; ownerId: number | null; createdAt: string | null; updatedAt: string | null; active: string | null; closed: string | null; project: string | null }
interface GroupMemberRow { groupId: number; userId: number; role: string }
interface ChatRow { id: number; type: string; entityType: string | null; entityId: string | null; title: string | null; authorId: number | null; createdAt: string | null }
interface ChatMemberRow { chatId: number; userId: number; notifyBlock: string | null; lastId: number | null }
interface MessageRow { id: number; chatId: number; authorId: number; message: string | null; createdAt: string | null; params: string | null }
interface MessageLikeRow { id: number; messageId: number; userId: string | number }
interface TaskRow { id: number; title: string | null; description: string | null; bbcode: string | null; priority: string | null; status: string | null; responsibleId: number | null; createdBy: number | null; createdAt: string | null; changedAt: string | null; closedAt: string | null; deadline: string | null; startPlan: string | null; timeEstimate: number | null; taskControl: string | null; groupId: number | null; parentId: number | null; forumTopicId: number | null; zombie: string | null }
interface TaskMemberRow { taskId: number; userId: number; type: string }
interface ChecklistRow { id: number; taskId: number; title: string | null; complete: string | null; sort: number | null; toggledBy: number | null; toggledAt: string | null; parentId: number | null; parentSort: number | null; isHeader: number }
interface TaskCommentRow { id: number; topicId: number; authorId: number | null; message: string | null; createdAt: string | null; editedAt: string | null; approved: string | null }
interface BlogPostRow { id: number; authorId: number; title: string | null; micro: string | null; text: string | null; textType: string | null; createdAt: string | null; publishedAt: string | null; important: number; rights: string[] | null }
interface BlogPostReadRow { postId: number; userId: number }
interface BlogCommentRow { id: number; postId: number; parentId: number | null; authorId: number; text: string | null; createdAt: string | null }
interface CalendarRow { id: number; calType: string; ownerId: number | null; createdBy: number | null; name: string | null; description: string | null; dateFrom: string | null; dateTo: string | null; tzFrom: string | null; tzTo: string | null; skipTime: string | null; length: number | null; rrule: string | null; createdAt: string | null; updatedAt: string | null; active: string | null }

interface ImportedUser { id: string; bitrixId: number; active: boolean; displayName: string; position: string; createdAt: string }
interface ImportedTask { parentId: number | null; createdBy: number; responsibleId: number; createdAt: string; updatedAt: string; members: boolean }

// ---------------------------------------------------------------- batching

class Batch {
  private pending = 0
  constructor(private readonly db: Db, private readonly size = BATCH_SIZE) {
    db.exec('BEGIN')
  }

  tick(count = 1): void {
    this.pending += count
    if (this.pending >= this.size) {
      this.db.exec('COMMIT')
      this.db.exec('BEGIN')
      this.pending = 0
    }
  }

  commit(): void {
    this.db.exec('COMMIT')
  }

  rollback(): void {
    if (this.db.inTransaction) this.db.exec('ROLLBACK')
  }
}

function progress(label: string, count: number, every = 250_000): void {
  if (count % every === 0) process.stdout.write(`  ${label}: ${count}\n`)
}

const bool = (value: boolean) => (value ? 1 : 0)
const clean = (value: string | null | undefined) => decodeHtmlEntities(value ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- importer

class Importer {
  readonly stats = new Stats()
  readonly timings: Record<string, number> = {}
  private readonly now = isoForSqlite(new Date())
  private workspaceId = ''
  private readonly users = new Map<number, ImportedUser>()
  private readonly orgUnits = new Set<number>()
  private readonly deptChildren = new Map<number, number[]>()
  private readonly deptUsers = new Map<number, number[]>()
  private readonly groupNames = new Map<number, string>()
  private readonly groupOwners = new Map<number, number | null>()
  private readonly groupMembers = new Map<number, Map<number, string>>()
  private readonly projects = new Set<number>()
  private readonly chatThreads = new Map<number, string>()
  private readonly tasks = new Map<number, ImportedTask>()
  private readonly topicTasks = new Map<number, number>()
  private readonly posts = new Set<number>()

  constructor(private readonly db: Db, private readonly dir: string, private readonly fingerprint: Fingerprint) {}

  /** Bitrix task ids that will be imported (known before any text is converted, for link rewriting). */
  private readonly importableTasks = new Set<number>()

  private resolveUser = (bitrixId: number): MentionTarget | undefined => {
    const user = this.users.get(bitrixId)
    return user ? { id: user.id, name: user.displayName } : undefined
  }

  private rewriteHref = (href: string): string => rewriteBitrixHref(href, {
    userId: (bitrixId) => this.users.get(bitrixId)?.id,
    taskId: (bitrixId) => (this.importableTasks.has(bitrixId) ? ids.task(bitrixId) : undefined),
  })

  /** Conversion options shared by every text with mentions and links. */
  private text(mode: 'markdown' | 'plain', emptyPlaceholder?: string) {
    return { mode, resolveUser: this.resolveUser, rewriteHref: this.rewriteHref, emptyPlaceholder }
  }

  private async scanTasks(): Promise<void> {
    for await (const row of readNdjson<TaskRow>(this.file('tasks'))) {
      if (row.zombie === 'Y' || !row.createdBy || !this.users.has(row.createdBy) || !row.responsibleId || !this.users.has(row.responsibleId)) continue
      this.importableTasks.add(row.id)
    }
  }

  private file(entity: Parameters<typeof ndjsonPath>[1]) {
    return ndjsonPath(this.dir, entity)
  }

  private async stage(name: string, run: () => Promise<void> | void): Promise<void> {
    const started = performance.now()
    process.stdout.write(`load ${name}...\n`)
    await run()
    const ms = performance.now() - started
    this.timings[name] = Math.round(ms)
    process.stdout.write(`load ${name}: ${formatDuration(ms)}\n`)
  }

  // ------------------------------------------------------------ preconditions

  prepare(resetImported: boolean): void {
    const workspaces = this.db.prepare('SELECT id FROM Workspace').all() as Array<{ id: string }>
    if (workspaces.length !== 1) throw new Error(`Expected exactly one Workspace, found ${workspaces.length}; run admin:create on a freshly migrated database first`)
    this.workspaceId = workspaces[0].id
    const imported = this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM Company WHERE id = ?) AS companies,
        (SELECT COUNT(*) FROM User WHERE id LIKE 'usr\\_b24\\_%' ESCAPE '\\') AS users`).get(COMPANY_ID) as { companies: number; users: number }
    if (imported.companies || imported.users) {
      if (!resetImported) throw new Error('The database already contains imported Bitrix rows; pass --reset-imported to delete them first')
      this.resetImported()
    }
  }

  private resetImported(): void {
    const started = performance.now()
    process.stdout.write('reset: deleting previously imported rows...\n')
    const statements = [
      `DELETE FROM FeedReadCursor WHERE companyId = '${COMPANY_ID}' OR id LIKE 'fcur_b24_%'`,
      `DELETE FROM FeedItemRecipient WHERE itemId IN (SELECT id FROM FeedItem WHERE companyId = '${COMPANY_ID}')`,
      `DELETE FROM FeedUserItemState WHERE feedItemId IN (SELECT id FROM FeedItem WHERE companyId = '${COMPANY_ID}')`,
      `DELETE FROM FeedSourceHead WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM FeedItem WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM Comment WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM FeedPost WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM ContentMention WHERE id LIKE 'mnt_b24_%'`,
      `DELETE FROM MessageThread WHERE id LIKE 'thr_b24_%'`,
      `DELETE FROM Event WHERE companyId = '${COMPANY_ID}'`,
      `UPDATE Task SET parentTaskId = NULL WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM Task WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM Project WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM UserOrgAssignment WHERE companyId = '${COMPANY_ID}'`,
      // Archived first: the partial unique sibling-name index only covers ACTIVE units.
      `UPDATE OrgUnit SET status = 'ARCHIVED', parentId = NULL WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM OrgUnit WHERE companyId = '${COMPANY_ID}'`,
      `DELETE FROM UsernameReservation WHERE id LIKE 'unr_b24_%'`,
      `DELETE FROM User WHERE id LIKE 'usr_b24_%'`,
      `DELETE FROM Company WHERE id = '${COMPANY_ID}'`,
    ]
    this.db.transaction(() => {
      for (const sql of statements) this.db.prepare(sql).run()
    })()
    this.timings.reset = Math.round(performance.now() - started)
    process.stdout.write(`reset: done in ${formatDuration(performance.now() - started)}\n`)
  }

  // ------------------------------------------------------------ company, users, org

  private company(): void {
    const taken = this.db.prepare('SELECT 1 FROM Company WHERE workspaceId = ? AND code = ?').get(this.workspaceId, 'bitrix24-import')
    this.db.prepare(`INSERT INTO Company (id, workspaceId, displayName, legalName, code, description, isActive, timezone, locale,
        workingDaysJson, holidayJson, version, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'Europe/Kyiv', 'uk-UA', '[1,2,3,4,5]', '[]', 1, ?, ?)`)
      .run(COMPANY_ID, this.workspaceId, 'Імпорт з Bitrix24', 'Імпорт з Bitrix24', taken ? 'bitrix24-import-b24' : 'bitrix24-import',
        'Тестовий перенос з Bitrix24. Адміністратор розкладе людей і підрозділи за компаніями пізніше.', this.now, this.now)
    this.stats.imported('company')
  }

  private async importUsers(): Promise<void> {
    const taken = new Set((this.db.prepare('SELECT normalizedUsername FROM UsernameReservation WHERE workspaceId = ? UNION SELECT normalizedUsername FROM User WHERE workspaceId = ?')
      .all(this.workspaceId, this.workspaceId) as Array<{ normalizedUsername: string }>).map((row) => row.normalizedUsername))
    const insertUser = this.db.prepare(`INSERT INTO User (id, workspaceId, primaryCompanyId, accountType, firstName, lastName, middleName, phone, gender,
        birthDate, displayName, normalizedDisplayName, username, normalizedUsername, contactEmail, jobTitle, approverId, timezone, locale,
        isActive, mustEnroll2FA, authorizationVersion, avatarAsset, createdAt, updatedAt)
      VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'Europe/Kyiv', 'uk-UA', ?, 0, 1, NULL, ?, ?)`)
    const insertReservation = this.db.prepare(`INSERT INTO UsernameReservation (id, workspaceId, normalizedUsername, currentUserId, previousUserId, state, reservedAt)
      VALUES (?, ?, ?, ?, NULL, 'ACTIVE', ?)`)
    const batch = new Batch(this.db)
    try {
      for await (const row of readNdjson<UserRow>(this.file('users'))) {
        this.stats.source('users')
        if (row.external && !row.referenced) {
          this.stats.skip('users', `external_${row.external}_without_content`)
          continue
        }
        const firstName = clean(row.name)
        const lastName = clean(row.lastName)
        const middleName = clean(row.secondName) || null
        const displayName = [lastName, firstName, middleName].filter(Boolean).join(' ') || clean(row.login) || `Bitrix ${row.id}`
        const username = allocateUsername(row.login, row.id, taken)
        const active = row.active === 'Y' && !row.external
        const createdAt = mskToIso(row.registeredAt) ?? this.now
        const updatedAt = mskToIso(row.updatedAt) ?? createdAt
        const birthDate = row.birthday && /^(19|20)\d{2}-\d{2}-\d{2}$/.test(row.birthday) && !row.birthday.endsWith('-00') ? `${row.birthday}T00:00:00.000+00:00` : null
        const gender = row.gender === 'F' ? 'FEMALE' : row.gender === 'M' ? 'MALE' : null
        const phone = clean(row.mobile) || clean(row.workPhone) || clean(row.phone) || null
        const position = clean(row.position)
        const id = ids.user(row.id)
        insertUser.run(id, this.workspaceId, COMPANY_ID, firstName, lastName, middleName, phone, gender, birthDate, displayName,
          normalizeUserSearchValue(displayName), username, username, position, bool(active), createdAt, updatedAt)
        insertReservation.run(ids.usernameReservation(row.id), this.workspaceId, username, id, createdAt)
        this.users.set(row.id, { id, bitrixId: row.id, active, displayName, position, createdAt })
        this.stats.imported('users')
        if (row.external) this.stats.imported(`users_external_inactive`)
        batch.tick()
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  private async importOrg(): Promise<void> {
    const departments: DepartmentRow[] = []
    for await (const row of readNdjson<DepartmentRow>(this.file('departments'))) departments.push(row)
    const insert = this.db.prepare(`INSERT INTO OrgUnit (id, workspaceId, companyId, sourceKey, parentId, name, icon, description, normalizedName,
        managerId, status, sortOrder, version, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 1, ?, ?)`)
    const pending = new Map(departments.map((row) => [row.id, row]))
    const batch = new Batch(this.db)
    try {
      // Rows come ordered by depth; loop until no parent is missing (handles any order).
      let progressMade = true
      while (pending.size && progressMade) {
        progressMade = false
        for (const row of [...pending.values()]) {
          if (row.parentId && pending.has(row.parentId)) continue
          pending.delete(row.id)
          progressMade = true
          this.stats.source('departments')
          const name = clean(row.name) || `Підрозділ ${row.id}`
          const normalizedName = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('uk')
          const parent = row.parentId && this.orgUnits.has(row.parentId) ? ids.orgUnit(row.parentId) : null
          if (row.parentId && !parent) this.stats.skip('departments_parent_link', 'parent_missing')
          const manager = row.headId ? this.users.get(row.headId) : undefined
          if (row.headId && !manager) this.stats.skip('departments_manager', 'manager_not_imported')
          const createdAt = mskToIso(row.createdAt) ?? this.now
          insert.run(ids.orgUnit(row.id), this.workspaceId, COMPANY_ID, `b24:dept:${row.id}`, parent, name, normalizedName,
            manager?.id ?? null, row.active === 'N' ? 'ARCHIVED' : 'ACTIVE', row.sort ?? 0, createdAt, mskToIso(row.updatedAt) ?? createdAt)
          this.orgUnits.add(row.id)
          if (row.parentId) this.deptChildren.set(row.parentId, [...(this.deptChildren.get(row.parentId) ?? []), row.id])
          this.stats.imported('departments')
          batch.tick()
        }
      }
      if (pending.size) this.stats.skip('departments', 'parent_cycle', pending.size)

      const assignments: UserDepartmentRow[] = []
      for await (const row of readNdjson<UserDepartmentRow>(this.file('user_departments'))) assignments.push(row)
      const perUser = new Map<number, number>()
      for (const row of assignments) perUser.set(row.userId, (perUser.get(row.userId) ?? 0) + 1)
      const insertAssignment = this.db.prepare(`INSERT OR IGNORE INTO UserOrgAssignment (id, companyId, userId, orgUnitId, isPrimary, positionTitle,
          startedAt, endedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      for (const row of assignments) {
        this.stats.source('user_departments')
        const user = this.users.get(row.userId)
        if (!user) { this.stats.skip('user_departments', 'user_not_imported'); continue }
        if (!this.orgUnits.has(row.deptId)) { this.stats.skip('user_departments', 'department_not_imported'); continue }
        // Primary only when it is the person's single department: no invented primary.
        const result = insertAssignment.run(ids.orgAssignment(row.userId, row.deptId), COMPANY_ID, user.id, ids.orgUnit(row.deptId),
          bool(perUser.get(row.userId) === 1), user.position || null, user.createdAt, user.createdAt, this.now)
        if (!result.changes) { this.stats.skip('user_departments', 'duplicate'); continue }
        this.deptUsers.set(row.deptId, [...(this.deptUsers.get(row.deptId) ?? []), row.userId])
        this.stats.imported('user_departments')
        batch.tick()
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  /** Users of a department and all of its descendants (Bitrix `DR<id>`). */
  private departmentUsers(deptId: number, recursive: boolean): number[] {
    const result = new Set<number>()
    const queue = [deptId]
    const seen = new Set<number>()
    while (queue.length) {
      const current = queue.shift()!
      if (seen.has(current)) continue
      seen.add(current)
      for (const userId of this.deptUsers.get(current) ?? []) result.add(userId)
      if (recursive) queue.push(...(this.deptChildren.get(current) ?? []))
    }
    return [...result]
  }

  // ------------------------------------------------------------ groups → projects (catalog)

  private async importGroups(): Promise<void> {
    for await (const row of readNdjson<GroupMemberRow>(this.file('group_members'))) {
      const members = this.groupMembers.get(row.groupId) ?? new Map<number, string>()
      const previous = members.get(row.userId)
      // A (owner) > E (moderator) > K (member)
      if (!previous || 'AEK'.indexOf(row.role) < 'AEK'.indexOf(previous)) members.set(row.userId, row.role)
      this.groupMembers.set(row.groupId, members)
    }
    const insert = this.db.prepare(`INSERT INTO Project (id, workspaceId, companyId, name, normalizedName, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    const names = new Set<string>()
    const batch = new Batch(this.db)
    try {
      for await (const row of readNdjson<GroupRow>(this.file('groups'))) {
        this.stats.source('groups_projects')
        let name = clean(row.name) || `Група ${row.id}`
        if (name.length > 120) name = name.slice(0, 120).trim()
        let normalizedName = name.toLocaleLowerCase('uk-UA')
        if (names.has(normalizedName)) {
          name = `${name.slice(0, 110)} (${row.id})`
          normalizedName = name.toLocaleLowerCase('uk-UA')
        }
        names.add(normalizedName)
        const createdAt = mskToIso(row.createdAt) ?? this.now
        insert.run(ids.project(row.id), this.workspaceId, COMPANY_ID, name, normalizedName, row.active === 'N' || row.closed === 'Y' ? 'ARCHIVED' : 'ACTIVE',
          createdAt, mskToIso(row.updatedAt) ?? createdAt)
        this.projects.add(row.id)
        this.groupNames.set(row.id, name)
        this.groupOwners.set(row.id, row.ownerId)
        this.stats.imported('groups_projects')
        batch.tick()
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  // ------------------------------------------------------------ chats → threads

  private async importThreads(): Promise<void> {
    const members = new Map<number, ChatMemberRow[]>()
    for await (const row of readNdjson<ChatMemberRow>(this.file('chat_members'))) {
      const list = members.get(row.chatId) ?? []
      list.push(row)
      members.set(row.chatId, list)
    }
    const insertThread = this.db.prepare(`INSERT INTO MessageThread (id, workspaceId, companyId, kind, title, entityType, entityId, directKey,
        createdById, lastMessageAt, version, createdAt) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, 1, ?)`)
    const insertParticipant = this.db.prepare(`INSERT INTO ThreadParticipant (id, threadId, userId, role, notificationMode, joinedAt, leftAt,
        lastReadMessageId, version) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1)`)
    const directKeys = new Map<string, string>()
    const groupsWithThread = new Set<number>()
    const batch = new Batch(this.db)
    try {
      for await (const chat of readNdjson<ChatRow>(this.file('chats'))) {
        const entity = chat.type === 'P' ? 'chats_direct' : 'chats_group'
        this.stats.source(entity)
        const createdAt = mskToIso(chat.createdAt) ?? this.now
        const chatMembers = members.get(chat.id) ?? []
        const author = chat.authorId ? this.users.get(chat.authorId) : undefined
        if (chat.type === 'P') {
          const userIds = [...new Set(chatMembers.map((member) => member.userId))]
          const imported = userIds.map((userId) => this.users.get(userId)).filter((user): user is ImportedUser => Boolean(user))
          if (userIds.length !== 2 || imported.length !== 2) {
            this.stats.skip(entity, userIds.length !== 2 ? 'direct_not_two_members' : 'direct_member_not_imported')
            continue
          }
          const sorted = imported.map((user) => user.id).sort()
          const directKey = this.fingerprint(JSON.stringify({ workspaceId: this.workspaceId, userIds: sorted }), 'chat.direct')
          const existing = directKeys.get(directKey)
          if (existing) {
            // Bitrix keeps one dialog per pair; a second one is merged into the canonical thread.
            this.chatThreads.set(chat.id, existing)
            this.stats.skip(entity, 'direct_duplicate_merged')
            continue
          }
          const threadId = ids.chatThread(chat.id)
          insertThread.run(threadId, this.workspaceId, COMPANY_ID, 'DIRECT', null, directKey, author?.id ?? null, createdAt)
          for (const user of imported) {
            const member = chatMembers.find((entry) => entry.userId === user.bitrixId)
            insertParticipant.run(ids.threadParticipant(threadId, user.bitrixId), threadId, user.id, 'MEMBER',
              member?.notifyBlock === 'Y' ? 'NONE' : 'ALL', createdAt)
          }
          directKeys.set(directKey, threadId)
          this.chatThreads.set(chat.id, threadId)
          this.stats.imported(entity)
          this.stats.imported('thread_participants', 2)
          batch.tick(3)
          continue
        }
        // Group chat: relation members, plus the Bitrix group's A/E/K members for SONET_GROUP chats.
        const participants = new Map<number, { owner: boolean; notifyBlock: boolean }>()
        for (const member of chatMembers) participants.set(member.userId, { owner: false, notifyBlock: member.notifyBlock === 'Y' })
        const groupId = chat.entityType === 'SONET_GROUP' ? Number.parseInt(chat.entityId ?? '', 10) : NaN
        const sonetGroup = Number.isFinite(groupId) && this.groupMembers.has(groupId) ? groupId : null
        if (sonetGroup !== null) {
          for (const [userId, role] of this.groupMembers.get(sonetGroup)!) {
            const current = participants.get(userId) ?? { owner: false, notifyBlock: false }
            participants.set(userId, { ...current, owner: current.owner || role === 'A' })
          }
        }
        if (chat.authorId && participants.has(chat.authorId)) participants.get(chat.authorId)!.owner = true
        const importedParticipants = [...participants].filter(([userId]) => this.users.has(userId))
        if (participants.size !== importedParticipants.length) this.stats.skip('thread_participants', 'user_not_imported', participants.size - importedParticipants.length)
        if (!importedParticipants.length) {
          this.stats.skip(entity, 'no_participants')
          continue
        }
        let title = clean(chat.title) || (sonetGroup !== null ? this.groupNames.get(sonetGroup) ?? '' : '')
        if (title.length < 2) title = `Груповий чат ${chat.id}`
        if (title.length > 120) {
          title = title.slice(0, 120).trim()
          this.stats.skip('chats_group_title', 'truncated_to_120')
        }
        const threadId = ids.chatThread(chat.id)
        insertThread.run(threadId, this.workspaceId, COMPANY_ID, 'GROUP', title, null, author?.id ?? null, createdAt)
        for (const [userId, participant] of importedParticipants) {
          insertParticipant.run(ids.threadParticipant(threadId, userId), threadId, this.users.get(userId)!.id,
            participant.owner ? 'OWNER' : 'MEMBER', participant.notifyBlock ? 'NONE' : 'ALL', createdAt)
        }
        if (sonetGroup !== null) groupsWithThread.add(sonetGroup)
        this.chatThreads.set(chat.id, threadId)
        this.stats.imported(entity)
        this.stats.imported('thread_participants', importedParticipants.length)
        batch.tick(1 + importedParticipants.length)
      }

      // Bitrix groups without their own chat still become (empty) group conversations of their members.
      for (const [groupId, name] of this.groupNames) {
        if (groupsWithThread.has(groupId)) continue
        this.stats.source('groups_without_chat')
        const groupMembers = [...(this.groupMembers.get(groupId) ?? new Map<number, string>())].filter(([userId]) => this.users.has(userId))
        if (!groupMembers.length) { this.stats.skip('groups_without_chat', 'no_members'); continue }
        const threadId = ids.groupThread(groupId)
        const createdAt = (this.db.prepare('SELECT createdAt FROM Project WHERE id = ?').get(ids.project(groupId)) as { createdAt: string }).createdAt
        const ownerId = this.groupOwners.get(groupId)
        insertThread.run(threadId, this.workspaceId, COMPANY_ID, 'GROUP', name.length >= 2 ? name : `Група ${groupId}`, null,
          ownerId ? this.users.get(ownerId)?.id ?? null : null, createdAt)
        for (const [userId, role] of groupMembers) {
          insertParticipant.run(ids.threadParticipant(threadId, userId), threadId, this.users.get(userId)!.id, role === 'A' ? 'OWNER' : 'MEMBER', 'ALL', createdAt)
        }
        this.stats.imported('groups_without_chat')
        this.stats.imported('thread_participants', groupMembers.length)
        batch.tick(1 + groupMembers.length)
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  private async importMessages(): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO Message (id, threadId, authorId, body, replyToId, createdAt, editedAt, deletedAt, version)
      VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, 1)`)
    const insertMention = this.db.prepare(`INSERT INTO ContentMention (id, workspaceId, sourceType, sourceId, userId, start, "end", label, createdAt)
      VALUES (?, ?, 'MESSAGE', ?, ?, ?, ?, ?, ?)`)
    const batch = new Batch(this.db)
    let count = 0
    try {
      for await (const row of readNdjson<MessageRow>(this.file('messages'))) {
        this.stats.source('messages')
        progress('messages read', ++count)
        const threadId = this.chatThreads.get(row.chatId)
        if (!threadId) { this.stats.skip('messages', 'chat_not_imported'); continue }
        const params = new Set((row.params ?? '').split(',').filter(Boolean))
        if (params.has('IS_DELETED')) { this.stats.skip('messages', 'deleted'); continue }
        if (params.has('CODE')) { this.stats.skip('messages', 'system_join_leave'); continue }
        if (!row.authorId) { this.stats.skip('messages', 'system_author'); continue }
        const author = this.users.get(row.authorId)
        if (!author) { this.stats.skip('messages', 'author_not_imported'); continue }
        const createdAt = mskToIso(row.createdAt)
        if (!createdAt) { this.stats.skip('messages', 'no_date'); continue }
        const converted = convertBitrixText(row.message, this.text('plain'))
        let body = converted.text
        if (!body.trim()) {
          body = params.has('FILE_ID') ? FILE_MARKER_TEXT : EMPTY_MESSAGE
          this.stats.imported(params.has('FILE_ID') ? 'messages_file_only_marker' : 'messages_empty_placeholder')
        }
        const id = ids.message(row.id)
        insert.run(id, threadId, author.id, body, createdAt)
        converted.mentions.forEach((mention, index) => {
          insertMention.run(ids.messageMention(row.id, index), this.workspaceId, id, mention.userId, mention.start, mention.end, mention.label, createdAt)
        })
        if (converted.mentions.length) this.stats.imported('message_mentions', converted.mentions.length)
        this.stats.imported('messages')
        batch.tick(1 + converted.mentions.length)
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }

    const like = this.db.prepare(`INSERT OR IGNORE INTO MessageReaction (id, messageId, userId, kind, createdAt)
      SELECT ?, m.id, ?, 'LIKE', m.createdAt FROM Message m WHERE m.id = ?`)
    const likes = new Batch(this.db)
    try {
      for await (const row of readNdjson<MessageLikeRow>(this.file('message_likes'))) {
        this.stats.source('message_likes')
        const user = this.users.get(Number(row.userId))
        if (!user) { this.stats.skip('message_likes', 'user_not_imported'); continue }
        const result = like.run(ids.messageReaction(row.id), user.id, ids.message(row.messageId))
        if (!result.changes) { this.stats.skip('message_likes', 'message_not_imported_or_duplicate'); continue }
        this.stats.imported('message_likes')
        likes.tick()
      }
      likes.commit()
    } catch (error) {
      likes.rollback()
      throw error
    }
  }

  /** History is read: every participant's marker points at the newest imported message. */
  private finishThreads(): void {
    this.db.prepare(`UPDATE MessageThread SET lastMessageAt = (SELECT MAX(m.createdAt) FROM Message m WHERE m.threadId = MessageThread.id)
      WHERE id LIKE 'thr_b24_%'`).run()
    this.db.prepare(`UPDATE ThreadParticipant SET lastReadMessageId = (
        SELECT m.id FROM Message m WHERE m.threadId = ThreadParticipant.threadId ORDER BY m.createdAt DESC, m.id DESC LIMIT 1)
      WHERE threadId LIKE 'thr_b24_%'`).run()
    // A thread is never older than its first message (old Bitrix chats have no DATE_CREATE).
    this.db.prepare(`UPDATE MessageThread SET createdAt = (SELECT MIN(m.createdAt) FROM Message m WHERE m.threadId = MessageThread.id)
      WHERE id LIKE 'thr_b24_%' AND createdAt > (SELECT MIN(m.createdAt) FROM Message m WHERE m.threadId = MessageThread.id)`).run()
  }

  // ------------------------------------------------------------ tasks

  private async importTasks(): Promise<void> {
    const takenNumbers = new Set((this.db.prepare(`SELECT number FROM Task`).all() as Array<{ number: string }>).map((row) => row.number))
    const insert = this.db.prepare(`INSERT INTO Task (id, workspaceId, companyId, projectId, parentTaskId, number, title, description, photoLayout,
        createdById, reporterId, status, requiresAcceptance, priority, startsAt, dueAt, estimatedMinutes, blockReason, completedAt, version,
        recurrenceId, recurrenceOccurrenceAt, archivedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL, NULL, NULL, ?, ?)`)
    const statusOf = (status: string | null) => {
      switch (status) {
        case '3': return 'IN_PROGRESS'
        case '4': return 'IN_REVIEW'
        case '5': case '7': return 'DONE'
        default: return 'NEW' // 1 new, 2 pending, 6 deferred
      }
    }
    const priorityOf = (priority: string | null) => (priority === '0' ? 'LOW' : priority === '2' ? 'HIGH' : 'MEDIUM')
    const batch = new Batch(this.db)
    let count = 0
    try {
      for await (const row of readNdjson<TaskRow>(this.file('tasks'))) {
        this.stats.source('tasks')
        progress('tasks read', ++count, 50_000)
        if (row.zombie === 'Y') { this.stats.skip('tasks', 'zombie_deleted'); continue }
        const creator = row.createdBy ? this.users.get(row.createdBy) : undefined
        if (!creator) { this.stats.skip('tasks', 'creator_not_imported'); continue }
        if (!row.responsibleId || !this.users.has(row.responsibleId)) { this.stats.skip('tasks', 'responsible_not_imported'); continue }
        const number = String(row.id)
        if (takenNumbers.has(number)) { this.stats.skip('tasks', 'number_taken'); continue }
        const createdAt = mskToIso(row.createdAt) ?? this.now
        const updatedAt = mskToIso(row.changedAt) ?? createdAt
        const status = statusOf(row.status)
        const completedAt = status === 'DONE' ? mskToIso(row.closedAt) ?? updatedAt : null
        const title = convertBitrixText(row.title, { mode: 'plain' }).text.replace(/\s+/g, ' ').trim() || UNTITLED
        const description = convertBitrixText(row.description, this.text('markdown')).text
        const estimatedMinutes = row.timeEstimate && row.timeEstimate > 0 ? Math.max(1, Math.round(row.timeEstimate / 60)) : null
        const projectId = row.groupId && this.projects.has(row.groupId) ? ids.project(row.groupId) : null
        insert.run(ids.task(row.id), this.workspaceId, COMPANY_ID, projectId, number, title, description, creator.id, creator.id, status,
          bool(row.taskControl === 'Y'), priorityOf(row.priority), mskToIso(row.startPlan), mskToIso(row.deadline), estimatedMinutes,
          completedAt, createdAt, updatedAt)
        this.tasks.set(row.id, { parentId: row.parentId || null, createdBy: row.createdBy!, responsibleId: row.responsibleId, createdAt, updatedAt, members: false })
        if (row.forumTopicId) this.topicTasks.set(row.forumTopicId, row.id)
        this.stats.imported('tasks')
        batch.tick()
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
    let maxNumber = 0
    for (const taskId of this.tasks.keys()) if (taskId > maxNumber) maxNumber = taskId
    this.db.prepare(`INSERT INTO TaskNumberSequence (scope, lastNumber, updatedAt) VALUES ('global', ?, ?)
      ON CONFLICT (scope) DO UPDATE SET lastNumber = MAX(lastNumber, excluded.lastNumber), updatedAt = excluded.updatedAt`).run(maxNumber, this.now)
  }

  private async importTaskParticipants(): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO TaskParticipant (id, taskId, userId, role, addedById, createdAt, updatedAt, removedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
    const rank: Record<string, number> = { RESPONSIBLE: 0, COLLABORATOR: 1, WATCHER: 2 }
    const batch = new Batch(this.db)
    const write = (taskId: number, task: ImportedTask, rows: TaskMemberRow[]) => {
      // Exactly one RESPONSIBLE: b_tasks.RESPONSIBLE_ID. One row per person, R > A > U.
      const roles = new Map<number, string>([[task.responsibleId, 'RESPONSIBLE']])
      for (const row of rows) {
        this.stats.source('task_members')
        if (!this.users.has(row.userId)) { this.stats.skip('task_members', 'user_not_imported'); continue }
        const role = row.type === 'R' ? (row.userId === task.responsibleId ? 'RESPONSIBLE' : 'COLLABORATOR') : row.type === 'A' ? 'COLLABORATOR' : 'WATCHER'
        if (row.type === 'R' && row.userId !== task.responsibleId) this.stats.imported('task_members_extra_responsible_as_collaborator')
        const current = roles.get(row.userId)
        if (row.type === 'R' && role === 'RESPONSIBLE') { this.stats.imported('task_members'); continue }
        // One row per person: a lower role of someone already listed is folded into the higher one.
        if (current && rank[current] <= rank[role]) { this.stats.skip('task_members', 'same_person_higher_role'); continue }
        this.stats.imported('task_members')
        roles.set(row.userId, role)
      }
      const creator = this.users.get(task.createdBy)!
      for (const [userId, role] of roles) {
        insert.run(ids.taskParticipant(taskId, userId), ids.task(taskId), this.users.get(userId)!.id, role, creator.id, task.createdAt, task.updatedAt)
        this.stats.imported('task_participants')
        if (role === 'RESPONSIBLE') this.stats.imported('task_participants_responsible')
      }
      task.members = true
      batch.tick(roles.size)
    }
    try {
      let currentTaskId: number | null = null
      let group: TaskMemberRow[] = []
      const flush = () => {
        if (currentTaskId === null) return
        const task = this.tasks.get(currentTaskId)
        if (task) write(currentTaskId, task, group)
        else {
          this.stats.source('task_members', group.length)
          this.stats.skip('task_members', 'task_not_imported', group.length)
        }
      }
      for await (const row of readNdjson<TaskMemberRow>(this.file('task_members'))) {
        if (row.taskId !== currentTaskId) {
          flush()
          currentTaskId = row.taskId
          group = []
        }
        group.push(row)
      }
      flush()
      for (const [taskId, task] of this.tasks) if (!task.members) write(taskId, task, [])
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  private linkSubtasks(): void {
    const update = this.db.prepare('UPDATE Task SET parentTaskId = ? WHERE id = ?')
    const batch = new Batch(this.db)
    try {
      for (const [taskId, task] of this.tasks) {
        if (!task.parentId) continue
        this.stats.source('task_parent_links')
        if (!this.tasks.has(task.parentId) || task.parentId === taskId) { this.stats.skip('task_parent_links', 'parent_not_imported'); continue }
        // Walk up to refuse cycles: the app's hierarchy assumes a tree.
        let cursor: number | null = task.parentId
        let cycle = false
        const seen = new Set<number>([taskId])
        while (cursor) {
          if (seen.has(cursor)) { cycle = true; break }
          seen.add(cursor)
          const parent = this.tasks.get(cursor)
          cursor = parent?.parentId && this.tasks.has(parent.parentId) ? parent.parentId : null
        }
        if (cycle) { this.stats.skip('task_parent_links', 'cycle'); task.parentId = null; continue }
        update.run(ids.task(task.parentId), ids.task(taskId))
        this.stats.imported('task_parent_links')
        batch.tick()
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  private async importChecklists(): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO TaskChecklistItem (id, taskId, title, isCompleted, position, completedById, completedAt, version,
        createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    const batch = new Batch(this.db)
    const write = (taskId: number, rows: ChecklistRow[]) => {
      const task = this.tasks.get(taskId)
      if (!task) { this.stats.skip('task_checklist', 'task_not_imported', rows.length); return }
      // LankaDWS checklists are flat: group headers (incl. BX_CHECKLIST_n placeholders) are dropped,
      // their items keep the header order, then their own order.
      const items = rows.filter((row) => {
        if (row.isHeader) { this.stats.skip('task_checklist', 'group_header'); return false }
        if (!row.parentId && /^BX_CHECKLIST/i.test(row.title ?? '')) { this.stats.skip('task_checklist', 'empty_group_header'); return false }
        return true
      })
      const key = (row: ChecklistRow) => [row.parentId ? row.parentSort ?? 0 : row.sort ?? 0, row.parentId ?? row.id, row.parentId ? row.sort ?? 0 : -1, row.id]
      items.sort((left, right) => {
        const a = key(left)
        const b = key(right)
        for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
        return 0
      })
      let position = 0
      for (const row of items) {
        const title = convertBitrixText(row.title, { mode: 'plain' }).text.replace(/\s+/g, ' ').trim()
        if (!title) { this.stats.skip('task_checklist', 'empty_title'); continue }
        const completed = row.complete === 'Y'
        const completedBy = completed && row.toggledBy ? this.users.get(row.toggledBy)?.id ?? null : null
        insert.run(ids.checklistItem(row.id), ids.task(taskId), title, bool(completed), position, completedBy,
          completed ? mskToIso(row.toggledAt) ?? task.updatedAt : null, task.createdAt, mskToIso(row.toggledAt) ?? task.updatedAt)
        position += 1
        this.stats.imported('task_checklist')
        batch.tick()
      }
    }
    try {
      let currentTaskId: number | null = null
      let group: ChecklistRow[] = []
      for await (const row of readNdjson<ChecklistRow>(this.file('task_checklist'))) {
        this.stats.source('task_checklist')
        if (row.taskId !== currentTaskId) {
          if (currentTaskId !== null) write(currentTaskId, group)
          currentTaskId = row.taskId
          group = []
        }
        group.push(row)
      }
      if (currentTaskId !== null) write(currentTaskId, group)
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  private async importTaskComments(): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO Comment (id, workspaceId, companyId, entityType, entityId, authorId, body, visibility,
        replyToCommentId, createdAt, editedAt, deletedAt, version) VALUES (?, ?, ?, 'TASK', ?, ?, ?, 'PARTICIPANTS', NULL, ?, ?, NULL, 1)`)
    const batch = new Batch(this.db)
    let count = 0
    try {
      for await (const row of readNdjson<TaskCommentRow>(this.file('task_comments'))) {
        this.stats.source('task_comments')
        progress('task comments read', ++count)
        const taskId = this.topicTasks.get(row.topicId)
        if (!taskId) { this.stats.skip('task_comments', 'task_not_imported'); continue }
        const author = row.authorId ? this.users.get(row.authorId) : undefined
        if (!author) { this.stats.skip('task_comments', 'author_not_imported'); continue }
        const createdAt = mskToIso(row.createdAt) ?? this.tasks.get(taskId)!.createdAt
        const editedAt = mskToIso(row.editedAt)
        const converted = convertBitrixText(row.message, this.text('markdown', EMPTY_COMMENT))
        if (converted.text === EMPTY_COMMENT) this.stats.imported('task_comments_empty_placeholder')
        insert.run(ids.taskComment(row.id), this.workspaceId, COMPANY_ID, ids.task(taskId), author.id, converted.text, createdAt,
          editedAt && editedAt > createdAt ? editedAt : null)
        this.stats.imported('task_comments')
        batch.tick()
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  // ------------------------------------------------------------ feed

  private postAudience(row: BlogPostRow): { company: boolean; userIds: number[] } {
    const users = new Set<number>()
    let company = false
    for (const entity of row.rights ?? []) {
      if (entity === 'G2' || entity === 'UA' || entity === 'AU') { company = true; continue }
      let match = /^U(\d+)$/.exec(entity)
      if (match) { users.add(Number(match[1])); continue }
      match = /^SG(\d+)$/.exec(entity)
      if (match) { for (const userId of this.groupMembers.get(Number(match[1]))?.keys() ?? []) users.add(userId); continue }
      match = /^(DR|D)(\d+)$/.exec(entity)
      if (match) { for (const userId of this.departmentUsers(Number(match[2]), match[1] === 'DR')) users.add(userId); continue }
      // US<id> (author's own blog), UP<id>, SG<id>_<role> and OSG… are access helpers, not destinations.
    }
    return { company, userIds: [...users].filter((userId) => this.users.has(userId)).sort((a, b) => a - b) }
  }

  private async importFeed(): Promise<void> {
    const reads = new Map<number, number[]>()
    for await (const row of readNdjson<BlogPostReadRow>(this.file('blog_post_reads'))) reads.set(row.postId, [...(reads.get(row.postId) ?? []), row.userId])
    const insertPost = this.db.prepare(`INSERT INTO FeedPost (id, workspaceId, companyId, authorId, body, photoLayout, status, requiresAcknowledgement,
        acknowledgementVersion, version, publishedAt, editedAt, archivedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, NULL, 'PUBLISHED', ?, ?, 1, ?, NULL, NULL, ?, ?)`)
    const insertRecipient = this.db.prepare(`INSERT INTO FeedPostRecipient (id, postId, type, recipientId, createdAt) VALUES (?, ?, ?, ?, ?)`)
    const insertAckRecipient = this.db.prepare(`INSERT INTO FeedAcknowledgementRecipient (id, postId, userId, acknowledgementVersion, createdAt) VALUES (?, ?, ?, 1, ?)`)
    const insertAck = this.db.prepare(`INSERT INTO FeedPostAcknowledgement (id, postId, userId, acknowledgementVersion, acknowledgedAt) VALUES (?, ?, ?, 1, ?)`)
    const insertItem = this.db.prepare(`INSERT INTO FeedItem (id, workspaceId, companyId, postId, fileShareId, sourceType, sourceId, sourceVersion,
        action, eventKey, actorId, visibility, safePayload, countsAsUnread, occurredAt, createdAt)
      VALUES (?, ?, ?, ?, NULL, 'POST', ?, 1, 'PUBLISHED', ?, ?, ?, ?, 0, ?, ?)`)
    const insertHead = this.db.prepare(`INSERT INTO FeedSourceHead (id, workspaceId, companyId, sourceType, sourceId, itemId, sourceVersion,
        countsAsUnread, occurredAt, createdAt, updatedAt) VALUES (?, ?, ?, 'POST', ?, ?, 1, 0, ?, ?, ?)`)
    const insertSubscription = this.db.prepare(`INSERT OR IGNORE INTO FeedSubscription (id, postId, userId, mode, createdAt, updatedAt) VALUES (?, ?, ?, 'ALL', ?, ?)`)
    const batch = new Batch(this.db)
    try {
      for await (const row of readNdjson<BlogPostRow>(this.file('blog_posts'))) {
        this.stats.source('feed_posts')
        const author = this.users.get(row.authorId)
        if (!author) { this.stats.skip('feed_posts', 'author_not_imported'); continue }
        const publishedAt = mskToIso(row.publishedAt) ?? mskToIso(row.createdAt) ?? this.now
        const createdAt = mskToIso(row.createdAt) ?? publishedAt
        let body = convertBitrixText(row.text, this.text('markdown')).text
        const title = clean(row.title)
        // Long posts (MICRO=N) carry a real title; micro-post titles are generated from the text.
        if (row.micro !== 'Y' && title) body = body ? `**${escapeMarkdown(title)}**\n\n${body}` : `**${escapeMarkdown(title)}**`
        if (!body.trim()) { body = EMPTY_POST; this.stats.imported('feed_posts_empty_placeholder') }
        const audience = this.postAudience(row)
        const userIds = audience.company ? [] : audience.userIds.length ? audience.userIds : [row.authorId]
        if (!audience.company && !audience.userIds.length) this.stats.imported('feed_posts_author_only_audience')
        const postId = ids.feedPost(row.id)
        const important = Boolean(row.important)
        insertPost.run(postId, this.workspaceId, COMPANY_ID, author.id, body, bool(important), important ? 1 : 0, publishedAt, createdAt, publishedAt)
        if (audience.company) insertRecipient.run(ids.feedPostRecipient(row.id, 'company'), postId, 'COMPANY', COMPANY_ID, publishedAt)
        for (const userId of userIds) insertRecipient.run(ids.feedPostRecipient(row.id, `u${userId}`), postId, 'USER', this.users.get(userId)!.id, publishedAt)
        if (important) {
          // Only people who confirmed in Bitrix become acknowledgement recipients: years-old posts must
          // not show up as pending confirmations for everyone else.
          for (const userId of new Set(reads.get(row.id) ?? [])) {
            const reader = this.users.get(userId)
            if (!reader || userId === row.authorId) { this.stats.skip('feed_acknowledgements', reader ? 'author' : 'user_not_imported'); continue }
            insertAckRecipient.run(ids.feedAckRecipient(row.id, userId), postId, reader.id, publishedAt)
            insertAck.run(ids.feedAck(row.id, userId), postId, reader.id, publishedAt)
            this.stats.imported('feed_acknowledgements')
          }
        }
        const itemId = ids.feedPostItem(row.id)
        insertItem.run(itemId, this.workspaceId, COMPANY_ID, postId, postId, `feed:post:${postId}:${COMPANY_ID}:v1:published`, author.id,
          audience.company ? 'COMPANY' : 'USERS', JSON.stringify({ postId, action: 'PUBLISHED', snippet: body.slice(0, 240) }), publishedAt, publishedAt)
        insertHead.run(ids.feedPostHead(row.id), this.workspaceId, COMPANY_ID, postId, itemId, publishedAt, publishedAt, publishedAt)
        insertSubscription.run(ids.feedSubscription(row.id, author.id), postId, author.id, publishedAt, publishedAt)
        this.posts.add(row.id)
        this.stats.imported('feed_posts')
        if (important) this.stats.imported('feed_posts_important')
        batch.tick(4 + userIds.length)
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }

    const insertComment = this.db.prepare(`INSERT INTO Comment (id, workspaceId, companyId, entityType, entityId, authorId, body, visibility,
        replyToCommentId, createdAt, editedAt, deletedAt, version) VALUES (?, ?, ?, 'FEED_POST', ?, ?, ?, 'FEED_AUDIENCE', ?, ?, NULL, NULL, 1)`)
    const comments = new Set<number>()
    const commentBatch = new Batch(this.db)
    try {
      for await (const row of readNdjson<BlogCommentRow>(this.file('blog_comments'))) {
        this.stats.source('feed_comments')
        if (!this.posts.has(row.postId)) { this.stats.skip('feed_comments', 'post_not_imported'); continue }
        const author = this.users.get(row.authorId)
        if (!author) { this.stats.skip('feed_comments', 'author_not_imported'); continue }
        const createdAt = mskToIso(row.createdAt) ?? this.now
        const body = convertBitrixText(row.text, this.text('markdown', EMPTY_COMMENT)).text
        const replyTo = row.parentId && comments.has(row.parentId) ? ids.feedComment(row.parentId) : null
        insertComment.run(ids.feedComment(row.id), this.workspaceId, COMPANY_ID, ids.feedPost(row.postId), author.id, body, replyTo, createdAt)
        insertSubscription.run(ids.feedSubscription(row.postId, author.id), ids.feedPost(row.postId), author.id, createdAt, createdAt)
        comments.add(row.id)
        this.stats.imported('feed_comments')
        commentBatch.tick(2)
      }
      commentBatch.commit()
    } catch (error) {
      commentBatch.rollback()
      throw error
    }
  }

  // ------------------------------------------------------------ calendar

  private async importEvents(): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO Event (id, workspaceId, companyId, ownerId, title, description, startAt, endAt, sourceTimezone, allDay,
        visibility, version, createdAt, updatedAt, recurrenceJson, requiresAcknowledgement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`)
    const insertAudience = this.db.prepare('INSERT INTO EventAudience (id, eventId, companyId) VALUES (?, ?, ?)')
    const insertItem = this.db.prepare(`INSERT INTO FeedItem (id, workspaceId, companyId, postId, fileShareId, sourceType, sourceId, sourceVersion,
        action, eventKey, actorId, visibility, safePayload, countsAsUnread, occurredAt, createdAt)
      VALUES (?, ?, ?, NULL, NULL, 'EVENT', ?, 1, 'IMPORTED', ?, ?, 'COMPANY', ?, 0, ?, ?)`)
    const insertHead = this.db.prepare(`INSERT INTO FeedSourceHead (id, workspaceId, companyId, sourceType, sourceId, itemId, sourceVersion,
        countsAsUnread, occurredAt, createdAt, updatedAt) VALUES (?, ?, ?, 'EVENT', ?, ?, 1, 0, ?, ?, ?)`)
    const insertRecipient = this.db.prepare('INSERT INTO FeedItemRecipient (id, itemId, userId, createdAt) VALUES (?, ?, ?, ?)')
    const batch = new Batch(this.db)
    try {
      for await (const row of readNdjson<CalendarRow>(this.file('calendar_events'))) {
        this.stats.source('events')
        if (row.active === 'N') { this.stats.skip('events', 'inactive'); continue }
        const ownerBitrixId = row.calType === 'user' ? row.ownerId : row.createdBy
        const owner = ownerBitrixId ? this.users.get(ownerBitrixId) : undefined
        if (!owner) { this.stats.skip('events', 'owner_not_imported'); continue }
        const times = eventTimes(row)
        if (!times) { this.stats.skip('events', 'invalid_dates'); continue }
        const recurrence = convertRrule(row.rrule, times)
        if (recurrence.kind === 'unsupported') this.stats.skip('event_recurrence', recurrence.reason)
        if (recurrence.kind === 'ok') this.stats.imported('event_recurrence')
        // Company calendar → shared with the company; personal and group calendars stay private to the owner.
        const shared = row.calType === 'company_calendar'
        const title = clean(row.name) || UNTITLED
        const description = convertBitrixText(row.description, this.text('plain')).text || null
        const createdAt = mskToIso(row.createdAt) ?? this.now
        const updatedAt = mskToIso(row.updatedAt) ?? createdAt
        const eventId = ids.event(row.id)
        insert.run(eventId, this.workspaceId, COMPANY_ID, owner.id, title, description, isoForSqlite(times.startAt), isoForSqlite(times.endAt),
          times.sourceTimezone, bool(times.allDay), shared ? 'INTERNAL' : 'PRIVATE', createdAt, updatedAt,
          recurrence.kind === 'ok' ? JSON.stringify(recurrence.recurrence) : null)
        insertAudience.run(ids.eventAudience(row.id), eventId, COMPANY_ID)
        if (shared) {
          const itemId = `fitem_b24_e${row.id}`
          const occurredAt = updatedAt < this.now ? updatedAt : this.now
          insertItem.run(itemId, this.workspaceId, COMPANY_ID, eventId, `feed:event:${eventId}:v1:imported`, owner.id,
            JSON.stringify({ schemaVersion: 1, sourceType: 'EVENT', sourceId: eventId, action: 'IMPORTED', historical: true }), occurredAt, this.now)
          insertHead.run(`fhead_b24_e${row.id}`, this.workspaceId, COMPANY_ID, eventId, itemId, occurredAt, this.now, this.now)
          if (owner.active) insertRecipient.run(`firec_b24_e${row.id}_${owner.bitrixId}`, itemId, owner.id, this.now)
          this.stats.imported('feed_event_items')
        }
        this.stats.imported(shared ? 'events_company' : row.calType === 'group' ? 'events_group_private' : 'events_personal')
        this.stats.imported('events')
        batch.tick(3)
      }
      batch.commit()
    } catch (error) {
      batch.rollback()
      throw error
    }
  }

  // ------------------------------------------------------------ historical feed projection for tasks

  /** Bulk equivalent of writeFeedProjection(historical, action IMPORTED) for every imported task. */
  private projectTasks(): void {
    const run = this.db.transaction(() => {
      const items = this.db.prepare(`INSERT INTO FeedItem (id, workspaceId, companyId, postId, fileShareId, sourceType, sourceId, sourceVersion,
          action, eventKey, actorId, visibility, safePayload, countsAsUnread, occurredAt, createdAt)
        SELECT 'fitem_b24_t' || t.number, t.workspaceId, t.companyId, NULL, NULL, 'TASK', t.id, t.version, 'IMPORTED',
          'feed:task:' || t.id || ':v' || t.version || ':imported', t.createdById, 'PARTICIPANTS',
          json_object('schemaVersion', 1, 'sourceType', 'TASK', 'sourceId', t.id, 'action', 'IMPORTED', 'historical', json('true')),
          0, MIN(t.updatedAt, @now), @now
        FROM Task t WHERE t.companyId = @company AND t.id LIKE 'tsk_b24_%'`).run({ now: this.now, company: COMPANY_ID })
      this.db.prepare(`INSERT INTO FeedSourceHead (id, workspaceId, companyId, sourceType, sourceId, itemId, sourceVersion, countsAsUnread,
          occurredAt, createdAt, updatedAt)
        SELECT 'fhead_b24_t' || t.number, t.workspaceId, t.companyId, 'TASK', t.id, 'fitem_b24_t' || t.number, t.version, 0,
          MIN(t.updatedAt, @now), @now, @now
        FROM Task t WHERE t.companyId = @company AND t.id LIKE 'tsk_b24_%'`).run({ now: this.now, company: COMPANY_ID })
      // Recipients: creator, reporter and participants, active accounts only (as writeFeedProjection does).
      const recipients = this.db.prepare(`INSERT OR IGNORE INTO FeedItemRecipient (id, itemId, userId, createdAt)
        SELECT 'firec_b24_t' || t.number || '_' || substr(r.userId, 9), 'fitem_b24_t' || t.number, r.userId, @now
        FROM (
          SELECT id AS taskId, createdById AS userId FROM Task WHERE companyId = @company
          UNION SELECT id, reporterId FROM Task WHERE companyId = @company
          UNION SELECT taskId, userId FROM TaskParticipant WHERE removedAt IS NULL
        ) r
        JOIN Task t ON t.id = r.taskId AND t.id LIKE 'tsk_b24_%'
        JOIN User u ON u.id = r.userId AND u.isActive = 1`).run({ now: this.now, company: COMPANY_ID })
      this.stats.imported('feed_task_items', items.changes)
      this.stats.imported('feed_task_item_recipients', recipients.changes)
    })
    run()
  }

  /** Mirrors FeedProjectionService.seedHistoricalReadCursors: history counts as read for every active person. */
  private seedReadCursors(): void {
    const users = this.db.prepare(`SELECT id FROM User WHERE primaryCompanyId = ? AND isActive = 1`).all(COMPANY_ID) as Array<{ id: string }>
    const latest = this.db.prepare(`SELECT fi.id, fi.occurredAt FROM FeedItem fi
      WHERE fi.workspaceId = @workspace AND fi.companyId = @company AND fi.countsAsUnread = 0 AND fi.occurredAt <= @now AND (
        EXISTS (SELECT 1 FROM FeedItemRecipient r WHERE r.itemId = fi.id AND r.userId = @user)
        OR (fi.visibility = 'COMPANY' AND fi.postId IS NULL)
        OR EXISTS (SELECT 1 FROM FeedPost p WHERE p.id = fi.postId AND p.authorId = @user)
        OR EXISTS (SELECT 1 FROM FeedPostRecipient pr WHERE pr.postId = fi.postId
          AND ((pr.type = 'COMPANY' AND pr.recipientId = @company) OR (pr.type = 'USER' AND pr.recipientId = @user))))
      ORDER BY fi.occurredAt DESC, fi.id DESC LIMIT 1`)
    const upsert = this.db.prepare(`INSERT INTO FeedReadCursor (id, userId, companyId, lastReadOccurredAt, lastReadItemId, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (userId, companyId) DO UPDATE SET lastReadOccurredAt = excluded.lastReadOccurredAt, lastReadItemId = excluded.lastReadItemId,
        updatedAt = excluded.updatedAt
      WHERE excluded.lastReadOccurredAt > FeedReadCursor.lastReadOccurredAt
        OR (excluded.lastReadOccurredAt = FeedReadCursor.lastReadOccurredAt AND excluded.lastReadItemId > FeedReadCursor.lastReadItemId)`)
    this.db.transaction(() => {
      for (const { id: userId } of users) {
        const item = latest.get({ workspace: this.workspaceId, company: COMPANY_ID, now: this.now, user: userId }) as { id: string; occurredAt: string } | undefined
        if (!item) continue
        upsert.run(`fcur_b24_${userId.slice('usr_b24_'.length)}`, userId, COMPANY_ID, item.occurredAt, item.id, this.now)
        this.stats.imported('feed_read_cursors')
      }
    })()
  }

  // ------------------------------------------------------------ run

  async run(): Promise<void> {
    await this.stage('company', () => this.company())
    await this.stage('users', () => this.importUsers())
    await this.stage('scan_tasks', () => this.scanTasks())
    await this.stage('org', () => this.importOrg())
    await this.stage('groups', () => this.importGroups())
    await this.stage('threads', () => this.importThreads())
    await this.stage('messages', () => this.importMessages())
    await this.stage('threads_finish', () => this.finishThreads())
    await this.stage('tasks', () => this.importTasks())
    await this.stage('task_participants', () => this.importTaskParticipants())
    await this.stage('task_hierarchy', () => this.linkSubtasks())
    await this.stage('task_checklist', () => this.importChecklists())
    await this.stage('task_comments', () => this.importTaskComments())
    await this.stage('feed', () => this.importFeed())
    await this.stage('events', () => this.importEvents())
    await this.stage('feed_tasks', () => this.projectTasks())
    await this.stage('feed_cursors', () => this.seedReadCursors())
  }
}

// ---------------------------------------------------------------- entry point

function databaseFileSize(path: string): number {
  let total = 0
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(`${path}${suffix}`)) total += statSync(`${path}${suffix}`).size
  return total
}

function resolveDatabasePath(option: string | undefined): string {
  const value = option ?? explicitDatabaseUrl
  if (!value) throw new Error('Pass --db <path> or set DATABASE_URL explicitly; the repository .env is deliberately not used for the target')
  const path = resolve(value.startsWith('file:') ? value.slice('file:'.length) : value)
  if (['beta.db', 'dev.db'].includes(basename(path)) && basename(dirname(path)) === 'prisma') {
    throw new Error(`Refusing to import into the application database ${path}; use a separate test database`)
  }
  if (!existsSync(path)) throw new Error(`Database not found: ${path} (run prisma migrate deploy and admin:create first)`)
  return path
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const input = stringOption(args, 'in', 'BITRIX_NDJSON_DIR')
  if (!input) throw new Error('Pass --in <ndjson dir> (or BITRIX_NDJSON_DIR)')
  const dir = resolve(input)
  const path = resolveDatabasePath(stringOption(args, 'db'))
  const reportPath = resolve(stringOption(args, 'report') ?? join(dir, 'load-report.json'))
  // Imported late: crypto.js loads the repository .env, which must not decide the target database.
  const { fingerprint } = await import('../../src/common/crypto.js')

  const started = performance.now()
  const sizeBefore = databaseFileSize(path)
  const db = new Database(path, { fileMustExist: true })
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = OFF')
  db.pragma('cache_size = -262144')
  db.pragma('temp_store = MEMORY')
  const importer = new Importer(db, dir, fingerprint)
  let failure: Error | undefined
  try {
    importer.prepare(args.has('reset-imported'))
    await importer.run()
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length) throw new Error(`foreign_key_check reported ${violations.length} violations`)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  } finally {
    db.pragma('synchronous = FULL')
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
  }
  const manifestPath = join(dir, 'extract-manifest.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as { sourceSummary?: unknown; entities?: unknown } : null
  const report = {
    finishedAt: new Date().toISOString(),
    status: failure ? 'FAILED' : 'COMPLETED',
    error: failure?.message ?? null,
    database: { path, bytesBefore: sizeBefore, bytesAfter: databaseFileSize(path) },
    totalMs: Math.round(performance.now() - started),
    stageMs: importer.timings,
    entities: importer.stats.toJSON(),
    extract: manifest,
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write('\nentity                               source   imported  skipped\n')
  for (const [name, entry] of Object.entries(importer.stats.toJSON())) {
    const skipped = Object.entries(entry.skipped).map(([reason, count]) => `${reason}=${count}`).join(', ')
    process.stdout.write(`${name.padEnd(36)} ${String(entry.source).padStart(8)} ${String(entry.imported).padStart(10)}  ${skipped}\n`)
  }
  process.stdout.write(`\nDB size: ${(sizeBefore / 1e6).toFixed(1)} MB → ${(report.database.bytesAfter / 1e6).toFixed(1)} MB; total ${formatDuration(report.totalMs)}\n`)
  process.stdout.write(`report: ${reportPath}\n`)
  if (failure) throw failure
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
